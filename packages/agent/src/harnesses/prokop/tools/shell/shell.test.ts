import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { ToolContext, PermissionAsk } from '@prokopai/sdk';
import { definition, execute } from './tool';

// ── Mock Bun.spawn so NO real processes ever execute ─────────

const FAKE_STDOUT = Buffer.from('mock-output');
const FAKE_STDERR = Buffer.from('');

const originalSpawn = Bun.spawn;
let spawnSyncCalls: { shell: string[]; cwd: string; env?: Record<string, string> }[] = [];
let spawnSyncBehavior: 'success' | 'fail' = 'success';

function createMockProcess(stdout: Buffer, stderr: Buffer, exitCode: number): ReturnType<typeof Bun.spawn> {
  return {
    stdout,
    stderr,
    exited: Promise.resolve(exitCode),
    exitCode,
    signalCode: null,
    killed: false,
    pid: -1,
    ref: () => {},
    unref: () => {},
    kill: () => true,
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function mockSpawn(
  cmd: string[],
  opts?: { cwd?: string; env?: Record<string, string> },
): ReturnType<typeof Bun.spawn> {
  spawnSyncCalls.push({ shell: cmd, cwd: opts?.cwd ?? '', env: opts?.env });
  return spawnSyncBehavior === 'success'
    ? createMockProcess(FAKE_STDOUT, FAKE_STDERR, 0)
    : createMockProcess(Buffer.from(''), Buffer.from('mock-error'), 1);
}

beforeEach(() => {
  spawnSyncCalls = [];
  spawnSyncBehavior = 'success';
  // @ts-expect-error -- overriding global for test isolation
  Bun.spawn = mockSpawn;
});

afterEach(() => {
  Bun.spawn = originalSpawn;
});

// ── Mock Tool Context ────────────────────────────────────────────

const WORKSPACE = '/workspace/project';

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: 'test-session-123',
    workspacePath: WORKSPACE,
    workspaceId: 'ws-1',
    abortSignal: new AbortController().signal,
    allowedPaths: [],

    fs: {
      resolve: (p: string) => {
        if (p.startsWith('/')) return p;
        return `${WORKSPACE}/${p}`;
      },
      readFile: mock(async (_path: string, _encoding?: string) => new Uint8Array()) as unknown as ToolContext['fs']['readFile'],
      writeFile: mock(async () => {}),
      appendFile: mock(async () => {}),
      readDir: mock(async () => []),
      exists: mock(async () => false),
      stat: mock(async () => ({
        size: 0,
        isDirectory: false,
        isFile: true,
        modifiedAt: new Date(),
        createdAt: new Date(),
      })),
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

    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },

    fetch: globalThis.fetch.bind(globalThis),

    resolvePath(path: string): string {
      if (path.startsWith('~/') || path === '~') {
        return `/home/user${path.slice(1)}`;
      }
      if (path.startsWith('/')) {
        return path;
      }
      return `${WORKSPACE}/${path}`;
    },

    isWithinWorkspace(path: string): boolean {
      return path.startsWith(WORKSPACE);
    },

    isSensitivePath(path: string): boolean {
      const lower = path.toLowerCase();
      return ['.env', '.pem', '.key', '.ssh/', 'id_rsa'].some(p => lower.includes(p));
    },

    isBlockedPath(path: string): boolean {
      return ['/etc/', '/usr/', '/bin/', '/sbin/'].some(p => path.startsWith(p));
    },

    addWorkspacePath: async () => true,
    removeWorkspacePath: async () => true,

    ...overrides,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function getAskCall(ctx: ToolContext): PermissionAsk {
  const calls = (ctx.ask as ReturnType<typeof mock>).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0] as PermissionAsk;
}

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('shell tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('shell');
  });

  test('has description mentioning shell commands', () => {
    expect(definition.description).toBeTruthy();
    expect(definition.description).toContain('shell command');
  });

  test('has required command input', () => {
    const schema = definition.inputSchema as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties.command).toBeDefined();
    expect(schema.required).toContain('command');
  });

  test('has optional cwd input', () => {
    const schema = definition.inputSchema as {
      properties: Record<string, { type: string; description: string }>;
    };
    expect(schema.properties.cwd).toBeDefined();
    expect(schema.properties.cwd.type).toBe('string');
  });

  test('has 60 second timeout', () => {
    expect(definition.timeout).toBe(60000);
  });
});

describe('windows shell selection', () => {
  test('uses cmd.exe directly on windows (no PowerShell wrapper)', async () => {
    const originalPlatform = process.platform;
    // Simulate Windows so the cmd.exe branch is exercised regardless of
    // the OS the test suite actually runs on.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      const ctx = createMockContext({ ask: mock(async () => true) as unknown as ToolContext['ask'] });
      await execute({ command: 'echo hello' }, ctx);
      expect(spawnSyncCalls.length).toBe(1);
      // cmd.exe inherits the server's environment directly; PATH/PATHEXT
      // resolution happens natively without a PowerShell intermediary.
      // resolveCmdExe() returns an absolute path when available, falling back
      // to the bare 'cmd.exe' name otherwise.
      const shellBin = spawnSyncCalls[0].shell[0];
      expect(shellBin).toMatch(/cmd\.exe$/);
      expect(spawnSyncCalls[0].shell.slice(1)).toEqual(['/d', '/s', '/c', 'echo hello']);
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
    expect(spawnSyncCalls.length).toBe(1);
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

// ══════════════════════════════════════════════════════════════════
// Risk Analysis: Low Risk Commands (no permission needed)
// ══════════════════════════════════════════════════════════════════

describe('risk analysis: low risk commands', () => {
  const safeCommands = [
    'ls',
    'ls -la',
    'pwd',
    'echo hello',
    'node --version',
    'git status',
    'git log --oneline -10',
    'bun --version',
    'npm list',
    'cat README.md',
    'head -20 package.json',
    'tail -20 package.json',
    'grep "TODO" src/index.ts',
    'find . -name "*.ts"',
    'wc -l src/index.ts',
    'which node',
    'env',
    'date',
    'whoami',
    'uname -a',
    'df -h',
    'ps aux',
  ];

  for (const cmd of safeCommands) {
    test(`"${cmd}" does NOT require permission`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      expect(ctx.ask).not.toHaveBeenCalled();
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// Permission Flow: approval runs the command, rejection never spawns
// ══════════════════════════════════════════════════════════════════

describe('permission flow', () => {
  test('approved concern runs the command', async () => {
    const ctx = createMockContext({ ask: mock(async () => true) as unknown as ToolContext['ask'] });
    const result = await execute({ command: 'rm -rf build' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
    expect(spawnSyncCalls.length).toBe(1);
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', 'rm -rf build']);
    expect(result.success).toBe(true);
  });

  test.each(['rm -rf build', 'cat .env', 'cat /etc/passwd'])(
    'rejected "%s" returns USER_REJECTION without spawning', async (command) => {
      const ctx = createMockContext({ ask: mock(async () => false) as unknown as ToolContext['ask'] });
      const result = await execute({ command }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toBe('USER_REJECTION');
      expect(spawnSyncCalls.length).toBe(0);
    });

  test('low-risk command executes without ask', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(spawnSyncCalls.length).toBe(1);
    expect(result.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// Command Execution (mocked spawn)
// ══════════════════════════════════════════════════════════════════

describe('command execution: mocked spawn', () => {
  test('successful spawn returns success true without error field', async () => {
    spawnSyncBehavior = 'success';
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    const output = result.result as { stdout: string; stderr: string; exitCode: number };
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toBe('mock-output');
  });

  test('failed spawn returns success false with error output', async () => {
    spawnSyncBehavior = 'fail';
    const ctx = createMockContext();
    const result = await execute({ command: 'ls missing' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('exited with code 1');
    const output = result.result as { stdout: string; stderr: string; exitCode: number };
    expect(output.exitCode).toBe(1);
    expect(output.stderr).toBe('mock-error');
  });

  test('result includes shell-output visualization', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('shell-output');
  });

  test('visualization includes truncated command', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    const viz = result.visualization as {
      type: string;
      command: string;
      stdout?: string;
      stderr?: string;
      exitCode: number;
    };
    expect(viz.command).toBe('echo hello');
    expect(viz.exitCode).toBe(0);
  });

  test('very long command is truncated to 100 chars in visualization', async () => {
    const ctx = createMockContext();
    const longCommand = 'echo ' + 'a'.repeat(200);
    const result = await execute({ command: longCommand }, ctx);
    const viz = result.visualization as { command: string };
    expect(viz.command.length).toBeLessThanOrEqual(100);
  });

  test('spawn uses workspacePath as cwd when no cwd provided', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello' }, ctx);
    expect(spawnSyncCalls[0].cwd).toBe(WORKSPACE);
  });

  test('spawn uses resolved cwd when cwd is provided', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello', cwd: WORKSPACE }, ctx);
    expect(spawnSyncCalls[0].cwd).toBe(WORKSPACE);
  });

  test('empty command returns EMPTY_COMMAND error', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: '' }, ctx);
    expect(spawnSyncCalls.length).toBe(0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('EMPTY_COMMAND');
  });
});

// ══════════════════════════════════════════════════════════════════
// Edge Cases
// ══════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  test('path-based base command strips directory prefix (/bin/echo → echo) is low-risk', async () => {
    const ctx = createMockContext();
    // /bin/echo → baseCommand 'echo' (path prefix stripped by parseCommand)
    // echo is not dangerous/filesystem, so no permission ask is needed
    const result = await execute({ command: '/bin/echo hello' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    // The command executes directly (spawn calls happen in the test env)
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
    await execute({ command: 'ls ./src ../project/lib' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
  });

  test('windows-style path is detected but resolved inside workspace by mock', async () => {
    const ctx = createMockContext();
    // Windows paths like C:\ are detected by extractPathArguments,
    // but the mock resolvePath treats non-Unix-absolute paths as relative
    // to workspace, so they resolve inside workspace and no ask is triggered.
    // On a real Windows system with proper resolvePath, this would trigger outside-workspace.
    const result = await execute({ command: 'cat C:\\Windows\\System32\\file.txt' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('no spawn happens when ask rejects for outside-workspace', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'cat /etc/passwd' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(spawnSyncCalls.length).toBe(0);
  });

  // ── Redundant cd stripping tests ────────────────────────────────────

  test('cd <workspace> && <cmd> strips redundant cd and avoids operator ask', async () => {
    const ctx = createMockContext();
    // Without stripping, the && would trigger operator detection
    const result = await execute({ command: `cd ${WORKSPACE} && npm install` }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    // The spawned command should be just "npm install", not the cd prefix
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', 'npm install']);
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
    // Different cd target: the command runs as written.
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', 'cd /some/other/path && npm install']);
  });

  test('cd <workspace> && <cmd> with explicit cwd param also strips', async () => {
    const ctx = createMockContext();
    const _result = await execute({
      command: `cd ${WORKSPACE} && bun test`,
      cwd: WORKSPACE,
    }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', 'bun test']);
  });

  test('cd with a relative path that differs from the workspace is kept', async () => {
    const ctx = createMockContext();
    // resolvePath('./project') = '/workspace/project/./project' ≠ '/workspace/project'
    // so this should NOT strip — it's a different path
    await execute({ command: 'cd ./project && ls' }, ctx);
    // The relative path won't match the workspace, so the cd is kept.
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', 'cd ./project && ls']);
  });

  test('cd <workspace> && <cmd> uses stripped command in visualization', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: `cd ${WORKSPACE} && echo hello` }, ctx);
    const viz = result.visualization as { type: string; command: string } | undefined;
    expect(viz?.command).toBe('echo hello');
  });

  test('bare cd without && is not stripped', async () => {
    const ctx = createMockContext();
    const _result = await execute({ command: `cd ${WORKSPACE}` }, ctx);
    // No && → no stripping, just runs the cd command
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', `cd ${WORKSPACE}`]);
  });

  // ── Sensitive file tests ──────────────────────────────────────────

  test('cat .env is blocked even when user rejects', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'cat .env' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(spawnSyncCalls.length).toBe(0);
  });

  test('cat normal.txt does not trigger sensitive-files', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'cat normal.txt' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});

describe('session temp and null policy', () => {
  test('ordinary null I/O runs without an ask and gets a session environment', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo ok > /dev/null' }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(spawnSyncCalls[0]?.env).toMatchObject({ TMPDIR: ctx.fs.tempDir });
  });

  test('session temp cwd runs without asking for workspace escape', async () => {
    const ctx = createMockContext();
    expect((await execute({ command: 'echo ok', cwd: ctx.fs.tempDir }, ctx)).success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });

  test('malformed commands never dispatch a process', async () => {
    const ctx = createMockContext();
    expect((await execute({ command: 'echo\0ok' }, ctx)).success).toBe(false);
    expect(spawnSyncCalls).toHaveLength(0);
  });

  test('a refused destructive command never dispatches despite its null redirect', async () => {
    const ctx = createMockContext({ ask: mock(async () => false) as unknown as ToolContext['ask'] });
    expect((await execute({ command: 'rm -rf / > /dev/null' }, ctx)).success).toBe(false);
    expect(ctx.ask).toHaveBeenCalled();
    expect(spawnSyncCalls).toHaveLength(0);
  });
});
