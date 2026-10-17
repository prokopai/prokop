import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ToolContext, PermissionAsk } from '@prokopai/sdk';
import { definition, createShellTool, shellArgv, BACKGROUND_WAIT_MS } from './tool';
import type { CommandRecord, CommandRegistry, StartCommandInput } from './commands';

// ── Fake registry: no real processes, scripted outcomes ──────────

type Script = { outcome: 'completes'; exitCode: number; output: string } | { outcome: 'runs'; output: string };

interface FakeRegistry extends CommandRegistry {
  starts: StartCommandInput[];
  script: Script;
  /** Ends a scripted running command. */
  finish(id: string, exitCode: number, extraOutput?: string): void;
  killed: string[];
}

function createFakeRegistry(): FakeRegistry {
  const records = new Map<string, CommandRecord & { output: string }>();
  const waiters = new Map<string, Set<() => void>>();
  let counter = 0;
  const settle = (id: string): void => {
    for (const waiter of waiters.get(id) ?? []) waiter();
    waiters.delete(id);
  };
  const fake: FakeRegistry = {
    starts: [],
    script: { outcome: 'completes', exitCode: 0, output: 'mock-output' },
    killed: [],
    start(input) {
      fake.starts.push(input);
      const id = `sh-${++counter}`;
      const scripted = fake.script;
      const record = {
        id, sessionId: input.sessionId, command: input.command, cwd: input.cwd,
        outputPath: join(input.outputDir, `${id}.out`),
        status: 'running' as const, exitCode: null, signal: null, startedAt: Date.now(), endedAt: null,
        bytes: 0, lines: 0, detached: false, output: '',
      };
      records.set(id, record);
      record.output = scripted.output;
      record.bytes = Buffer.byteLength(scripted.output);
      if (scripted.outcome === 'completes') {
        Object.assign(record, { status: 'completed', exitCode: scripted.exitCode, endedAt: Date.now() });
      }
      return record;
    },
    finish(id, exitCode, extraOutput = '') {
      const record = records.get(id)!;
      record.output += extraOutput;
      record.bytes = Buffer.byteLength(record.output);
      Object.assign(record, { status: 'completed', exitCode, endedAt: Date.now() });
      settle(id);
    },
    get: (id) => records.get(id) ?? null,
    list: (sessionId) => [...records.values()].filter((record) => record.sessionId === sessionId),
    wait(id, timeoutMs, signal) {
      const record = records.get(id)!;
      if (record.status !== 'running' || signal?.aborted) return Promise.resolve(record);
      return new Promise((resolve) => {
        const done = (): void => { clearTimeout(timer); resolve(record); };
        const timer = setTimeout(done, timeoutMs);
        signal?.addEventListener('abort', done, { once: true });
        const set = waiters.get(id) ?? new Set();
        set.add(done);
        waiters.set(id, set);
      });
    },
    detach(id) { records.get(id)!.detached = true; },
    read(id, cursor, maxBytes) {
      const record = records.get(id)!;
      const text = record.output.slice(cursor, cursor + maxBytes);
      return { text, cursor: cursor + text.length, total: record.bytes };
    },
    tail(id, maxBytes) {
      const record = records.get(id)!;
      return { text: record.output.slice(-maxBytes), truncated: record.output.length > maxBytes };
    },
    async kill(id) {
      const record = records.get(id);
      if (!record) return null;
      fake.killed.push(id);
      Object.assign(record, { status: 'killed', signal: 'SIGTERM', endedAt: Date.now() });
      settle(id);
      return record;
    },
    async killForSession() {},
    onExit: () => () => {},
    shutdown() {},
  };
  return fake;
}

let registry: FakeRegistry;
let execute: ReturnType<typeof createShellTool>['execute'];

beforeEach(() => {
  registry = createFakeRegistry();
  // argv is injected: the resolved shell differs per machine.
  execute = createShellTool({ registry, argv: (command) => ['sh', '-c', command] }).execute;
});

// ── Mock Tool Context ────────────────────────────────────────────

// A real directory: the tool checks that cwd exists before starting anything.
const WORKSPACE = realpathSync(mkdtempSync(join(tmpdir(), 'shell-tool-')));
afterAll(() => rmSync(WORKSPACE, { recursive: true, force: true }));

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: 'test-session-123',
    workspacePath: WORKSPACE,
    workspaceId: 'ws-1',
    abortSignal: new AbortController().signal,
    allowedPaths: [],

    fs: {
      resolve: (p: string) => (p.startsWith('/') ? p : `${WORKSPACE}/${p}`),
      readFile: mock(async (_path: string, _encoding?: string) => new Uint8Array()) as unknown as ToolContext['fs']['readFile'],
      writeFile: mock(async () => {}),
      appendFile: mock(async () => {}),
      readDir: mock(async () => []),
      exists: mock(async () => false),
      stat: mock(async () => ({ size: 0, isDirectory: false, isFile: true, modifiedAt: new Date(), createdAt: new Date() })),
      mkdir: mock(async () => {}),
      rm: mock(async () => {}),
      rename: mock(async () => {}),
      detectLanguage: () => 'text',
      tempDir: '/tmp/jean2/test-session-123',
    },

    llm: {
      generateText: mock(async () => ''),
      generateStructured: mock(async () => ({})) as unknown as ToolContext['llm']['generateStructured'],
    },

    ask: mock(async (_request: unknown) => true) as unknown as ToolContext['ask'],

    env: {
      get: (_key: string) => undefined,
      require: (_key: string) => { throw new Error('Not set'); },
    },

    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },

    fetch: globalThis.fetch.bind(globalThis),

    resolvePath(path: string): string {
      if (path.startsWith('~/') || path === '~') return `/home/user${path.slice(1)}`;
      if (path.startsWith('/')) return path;
      return `${WORKSPACE}/${path}`;
    },
    isWithinWorkspace: (path: string) => path.startsWith(WORKSPACE),
    isSensitivePath(path: string): boolean {
      const lower = path.toLowerCase();
      return ['.env', '.pem', '.key', '.ssh/', 'id_rsa'].some(p => lower.includes(p));
    },
    isBlockedPath: (path: string) => ['/etc/', '/usr/', '/bin/', '/sbin/'].some(p => path.startsWith(p)),
    addWorkspacePath: async () => true,
    removeWorkspacePath: async () => true,

    ...overrides,
  };
}

function getAskCall(ctx: ToolContext): PermissionAsk {
  const calls = (ctx.ask as ReturnType<typeof mock>).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0] as PermissionAsk;
}

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('shell tool definition', () => {
  test('is the one command tool: run by default, read and kill as follow-ups', () => {
    expect(definition.name).toBe('shell');
    expect(definition.description).toContain('shell command');
    const schema = definition.inputSchema as { properties: Record<string, { type?: string; enum?: string[] }>; required: string[] };
    expect(schema.properties.command.type).toBe('string');
    expect(schema.properties.cwd.type).toBe('string');
    expect(schema.properties.action.enum).toEqual(['run', 'read', 'kill']);
    expect(schema.required).toEqual([]);
  });

  test('has no executor deadline: the wait window is its own', () => {
    expect(definition.timeout).toBeNull();
  });
});

describe('shell selection', () => {
  test('uses cmd.exe directly on windows (no PowerShell wrapper)', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const argv = shellArgv('echo hello');
      expect(argv[0]).toMatch(/cmd\.exe$/);
      expect(argv.slice(1)).toEqual(['/d', '/s', '/c', 'echo hello']);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  test('uses a POSIX shell with -c elsewhere', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const argv = shellArgv('echo hello');
      expect(argv[0]).toMatch(/\/(sh|bash|zsh|dash|ksh)$/);
      expect(argv.slice(1)).toEqual(['-c', 'echo hello']);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// Permissions v2: ask only on a real concern
// (detailed classification lives in server/tests/domains/permissions*.test.ts)
// ══════════════════════════════════════════════════════════════════

describe('permissions v2: ask only on a real concern', () => {
  test.each([
    ['cat .env', 'sensitive'],
    ['cat .env.production', 'sensitive'],
    ['cat server.pem', 'sensitive'],
    ['cat id_rsa.key', 'sensitive'],
    ['grep DATABASE .env', 'sensitive'],
    ['rm -rf build', 'destructive'],
    ['sudo apt install something', 'destructive'],
    ['cat /etc/passwd', 'escape'],
  ])('"%s" asks with the %s concern', async (command, concern) => {
    const ctx = createMockContext();
    await execute({ command }, ctx);
    const permAsk = getAskCall(ctx) as PermissionAsk & { concerns?: string[] };
    expect(permAsk.type).toBe('permission');
    expect(permAsk.concerns).toContain(concern);
    expect(permAsk.metadata?.command).toBe(command);
  });

  test.each([
    'curl http://example.com',
    'echo hello | grep h',
    'echo hello && echo world',
    'mkdir new-directory',
    'git push origin main',
  ])('"%s" has no concern and runs without asking', async (command) => {
    const ctx = createMockContext();
    const result = await execute({ command }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(registry.starts).toHaveLength(1);
    expect(result.success).toBe(true);
  });

  test('a concern in any segment of a compound command asks', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello && rm -rf build' }, ctx);
    const permAsk = getAskCall(ctx) as PermissionAsk & { concerns?: string[] };
    expect(permAsk.concerns).toContain('destructive');
  });

  test('a protected target outside the workspace is critical and only allowed once', async () => {
    const ctx = createMockContext();
    await execute({ command: 'rm /etc/config' }, ctx);
    const permAsk = getAskCall(ctx) as PermissionAsk & { concerns?: string[]; allowedScopes?: string[] };
    expect(permAsk.risk).toBe('critical');
    expect(permAsk.concerns).toContain('escape');
    expect(permAsk.allowedScopes).toEqual(['once']);
  });
});

describe('risk analysis: low risk commands', () => {
  const safeCommands = [
    'ls', 'ls -la', 'pwd', 'echo hello', 'node --version', 'git status', 'git log --oneline -10',
    'bun --version', 'npm list', 'cat README.md', 'head -20 package.json', 'tail -20 package.json',
    'grep "TODO" src/index.ts', 'find . -name "*.ts"', 'wc -l src/index.ts', 'which node', 'env',
    'date', 'whoami', 'uname -a', 'df -h', 'ps aux',
  ];

  for (const cmd of safeCommands) {
    test(`"${cmd}" does NOT require permission`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      expect(ctx.ask).not.toHaveBeenCalled();
    });
  }
});

describe('permission flow', () => {
  test('approved concern runs the command', async () => {
    const ctx = createMockContext({ ask: mock(async () => true) as unknown as ToolContext['ask'] });
    const result = await execute({ command: 'rm -rf build' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
    expect(registry.starts).toHaveLength(1);
    expect(registry.starts[0].argv).toEqual(['sh', '-c', 'rm -rf build']);
    expect(result.success).toBe(true);
  });

  test.each(['rm -rf build', 'cat .env', 'cat /etc/passwd'])(
    'rejected "%s" returns USER_REJECTION without starting anything', async (command) => {
      const ctx = createMockContext({ ask: mock(async () => false) as unknown as ToolContext['ask'] });
      const result = await execute({ command }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toBe('USER_REJECTION');
      expect(registry.starts).toHaveLength(0);
    });

  test('low-risk command executes without ask', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(registry.starts).toHaveLength(1);
    expect(result.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// Command execution
// ══════════════════════════════════════════════════════════════════

describe('command execution', () => {
  test('a completed command returns its exit code, output and output file', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    const output = result.result as { status: string; exitCode: number; output: string; outputPath: string; durationMs: number };
    expect(output.status).toBe('completed');
    expect(output.exitCode).toBe(0);
    expect(output.output).toBe('mock-output');
    expect(output.outputPath).toBe('/tmp/jean2/test-session-123/shell/sh-1.out');
    expect(registry.starts[0].outputDir).toBe('/tmp/jean2/test-session-123/shell');
  });

  test('a failing command returns success false with the last output line in the error', async () => {
    registry.script = { outcome: 'completes', exitCode: 1, output: 'warning\nmock-error\n' };
    const ctx = createMockContext();
    const result = await execute({ command: 'ls missing' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Command exited with code 1: mock-error');
    expect((result.result as { exitCode: number }).exitCode).toBe(1);
  });

  test('result includes a shell-output visualization with the truncated command', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo ' + 'a'.repeat(200) }, ctx);
    const viz = result.visualization as { type: string; command: string; stdout?: string; exitCode?: number; status?: string };
    expect(viz.type).toBe('shell-output');
    expect(viz.command.length).toBeLessThanOrEqual(100);
    expect(viz.stdout).toBe('mock-output');
    expect(viz.exitCode).toBe(0);
    expect(viz.status).toBeUndefined();
  });

  test('cwd defaults to the workspace and follows the cwd input', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello' }, ctx);
    await execute({ command: 'echo hello', cwd: WORKSPACE }, ctx);
    expect(registry.starts[0].cwd).toBe(WORKSPACE);
    expect(registry.starts[1].cwd).toBe(WORKSPACE);
    expect(registry.starts[0].env.TMPDIR).toBe('/tmp/jean2/test-session-123');
  });

  test('a cwd that does not exist fails before anything starts', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello', cwd: `${WORKSPACE}/missing` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
    expect(registry.starts).toHaveLength(0);
  });

  test('empty command returns EMPTY_COMMAND error', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: '' }, ctx);
    expect(registry.starts).toHaveLength(0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('EMPTY_COMMAND');
  });
});

// ══════════════════════════════════════════════════════════════════
// Wait window, background, follow-ups
// ══════════════════════════════════════════════════════════════════

describe('running commands', () => {
  test('a command that outlives the wait window is returned as running and detached', async () => {
    registry.script = { outcome: 'runs', output: 'booting\n' };
    const ctx = createMockContext();
    const result = await execute({ command: 'npm run dev', timeout: 1000 }, ctx);
    expect(result.success).toBe(true);
    const output = result.result as { status: string; id: string; output: string; cursor: number; hint: string };
    expect(output.status).toBe('running');
    expect(output.id).toBe('sh-1');
    expect(output.output).toBe('booting\n');
    expect(output.cursor).toBe(8);
    expect(output.hint).toContain('do not poll');
    expect(registry.get('sh-1')?.detached).toBe(true);
    expect((result.visualization as { status?: string }).status).toBe('running');
  });

  test('background returns within the short start window', async () => {
    registry.script = { outcome: 'runs', output: '' };
    const ctx = createMockContext();
    const startedAt = Date.now();
    const result = await execute({ command: 'npm run dev', background: true }, ctx);
    expect(Date.now() - startedAt).toBeLessThan(BACKGROUND_WAIT_MS + 500);
    expect((result.result as { status: string }).status).toBe('running');
  });

  test('a command finishing inside the window is reported as completed', async () => {
    registry.script = { outcome: 'runs', output: '' };
    const ctx = createMockContext();
    const pending = execute({ command: 'bun test', timeout: 5000 }, ctx);
    await Bun.sleep(20);
    registry.finish('sh-1', 0, 'all green\n');
    const result = await pending;
    expect((result.result as { status: string; output: string }).status).toBe('completed');
    expect((result.result as { output: string }).output).toBe('all green\n');
    expect(registry.get('sh-1')?.detached).toBe(false);
  });

  test('interrupting the turn during the wait kills the command', async () => {
    registry.script = { outcome: 'runs', output: '' };
    const controller = new AbortController();
    const ctx = createMockContext({ abortSignal: controller.signal });
    const pending = execute({ command: 'sleep 100', timeout: 5000 }, ctx);
    await Bun.sleep(20);
    controller.abort();
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool execution interrupted');
    expect(registry.killed).toEqual(['sh-1']);
  });

  test('read returns new output from the cursor and the status', async () => {
    registry.script = { outcome: 'runs', output: 'line one\n' };
    const ctx = createMockContext();
    await execute({ command: 'npm run dev', timeout: 1000 }, ctx);
    registry.finish('sh-1', 0, 'line two\n');
    const result = await execute({ action: 'read', id: 'sh-1', cursor: 9 }, ctx);
    expect(result.success).toBe(true);
    const output = result.result as { status: string; exitCode: number; output: string; cursor: number; totalBytes: number };
    expect(output.status).toBe('completed');
    expect(output.exitCode).toBe(0);
    expect(output.output).toBe('line two\n');
    expect(output.cursor).toBe(18);
    expect(output.totalBytes).toBe(18);
  });

  test('read with a timeout waits for the command', async () => {
    registry.script = { outcome: 'runs', output: '' };
    const ctx = createMockContext();
    await execute({ command: 'slow', timeout: 1000 }, ctx);
    const pending = execute({ action: 'read', id: 'sh-1', timeout: 5000 }, ctx);
    await Bun.sleep(20);
    registry.finish('sh-1', 2, 'boom\n');
    const output = (await pending).result as { status: string; exitCode: number; output: string };
    expect(output.status).toBe('completed');
    expect(output.exitCode).toBe(2);
    expect(output.output).toBe('boom\n');
  });

  test('kill stops a running command', async () => {
    registry.script = { outcome: 'runs', output: '' };
    const ctx = createMockContext();
    await execute({ command: 'npm run dev', background: true }, ctx);
    const result = await execute({ action: 'kill', id: 'sh-1' }, ctx);
    expect(result.success).toBe(true);
    expect((result.result as { status: string }).status).toBe('killed');
    expect(registry.killed).toEqual(['sh-1']);
  });

  test('kill of a finished command says so without failing', async () => {
    const ctx = createMockContext();
    await execute({ command: 'true' }, ctx);
    const result = await execute({ action: 'kill', id: 'sh-1' }, ctx);
    expect(result.success).toBe(true);
    expect((result.result as { note: string }).note).toContain('already finished');
    expect(registry.killed).toEqual([]);
  });

  test('read and kill need an id the session owns', async () => {
    registry.script = { outcome: 'runs', output: '' };
    await execute({ command: 'npm run dev', background: true }, createMockContext());
    const other = createMockContext({ sessionId: 'another-session' });
    expect((await execute({ action: 'read', id: 'sh-1' }, other)).error).toContain('Unknown command');
    expect((await execute({ action: 'kill', id: 'sh-1' }, other)).error).toContain('Unknown command');
    expect((await execute({ action: 'read' }, other)).error).toContain('id is required');
    expect((await execute({ action: 'kill', id: 'nope' }, other)).error).toContain('Unknown command');
  });
});

// ══════════════════════════════════════════════════════════════════
// Edge Cases
// ══════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  test('path-based base command strips directory prefix (/bin/echo → echo) is low-risk', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: '/bin/echo hello' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('npm/pnpm/yarn/bun subcommands identified but safe', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'npm install' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('command with only flags still works', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'ls --help' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('relative path argument stays inside workspace', async () => {
    const ctx = createMockContext();
    // Both paths normalize inside the workspace root.
    await execute({ command: `ls ./src ../${basename(WORKSPACE)}/lib` }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
  });

  test('windows-style path is detected but resolved inside workspace by mock', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'cat C:\\Windows\\System32\\file.txt' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('nothing starts when ask rejects for outside-workspace', async () => {
    const ctx = createMockContext({ ask: mock(async () => false) as unknown as ToolContext['ask'] });
    const result = await execute({ command: 'cat /etc/passwd' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(registry.starts).toHaveLength(0);
  });

  // ── Redundant cd stripping ──────────────────────────────────────

  test('cd <workspace> && <cmd> strips redundant cd and avoids operator ask', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: `cd ${WORKSPACE} && npm install` }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(registry.starts[0].argv).toEqual(['sh', '-c', 'npm install']);
  });

  test('cd <workspace> && <dangerous> still catches dangerous command', async () => {
    const ctx = createMockContext();
    await execute({ command: `cd ${WORKSPACE} && rm -rf build` }, ctx);
    const permAsk = getAskCall(ctx) as PermissionAsk & { concerns?: string[] };
    expect(permAsk.concerns).toContain('destructive');
  });

  test('cd <workspace> && cat .env still catches sensitive file', async () => {
    const ctx = createMockContext();
    await execute({ command: `cd ${WORKSPACE} && cat .env` }, ctx);
    const permAsk = getAskCall(ctx) as PermissionAsk & { concerns?: string[] };
    expect(permAsk.concerns).toContain('sensitive');
  });

  test('cd <other_path> && <cmd> does NOT strip when target differs from cwd', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cd /some/other/path && npm install' }, ctx);
    expect(registry.starts[0].argv).toEqual(['sh', '-c', 'cd /some/other/path && npm install']);
  });

  test('cd <workspace> && <cmd> with explicit cwd param also strips', async () => {
    const ctx = createMockContext();
    await execute({ command: `cd ${WORKSPACE} && bun test`, cwd: WORKSPACE }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(registry.starts[0].argv).toEqual(['sh', '-c', 'bun test']);
  });

  test('cd with a relative path that differs from the workspace is kept', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cd ./project && ls' }, ctx);
    expect(registry.starts[0].argv).toEqual(['sh', '-c', 'cd ./project && ls']);
  });

  test('cd <workspace> && <cmd> uses stripped command in visualization', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: `cd ${WORKSPACE} && echo hello` }, ctx);
    const viz = result.visualization as { type: string; command: string } | undefined;
    expect(viz?.command).toBe('echo hello');
  });

  test('bare cd without && is not stripped', async () => {
    const ctx = createMockContext();
    await execute({ command: `cd ${WORKSPACE}` }, ctx);
    expect(registry.starts[0].argv).toEqual(['sh', '-c', `cd ${WORKSPACE}`]);
  });
});
