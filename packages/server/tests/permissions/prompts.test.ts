import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { ASK_TIMEOUT, createAskApi, rejectPendingAsksBySession } from '@prokopai/agent/internal/harnesses/prokop/permission/ask-user-api';
import { getRuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { getPermissionTimeoutMs } from '@prokopai/core/infrastructure/runtime/environment';
import { listPendingAsksBySession } from '@/infrastructure/sqlite/pending-asks';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspaceWithSession } from '#tests/seed';
import {
  requestPermission,
  resolvePermission,
} from '@prokopai/agent/internal/harnesses/prokop/permission/permission-request-manager';
import { fileConcernAsk } from '@prokopai/agent/internal/harnesses/prokop/tools/file-permission';
import { classifyShellCommand, type PermissionMode } from '@prokopai/core/domains/permissions';
import { createOutsideWorkspaceAsk, type Ask, type PermissionAsk } from '@prokopai/sdk';

// What the user sees in the Prokop harness, end to end: asks come from the
// real classifiers (never hand-built), run through the real permission
// runtime, and remembered approvals go through the real grant store.

const ROOT = '/tmp/prokop-qa-workspace';

type Grant = 'once' | 'session' | 'workspace' | 'deny';

function shellAsk(command: string): PermissionAsk {
  const classification = classifyShellCommand(command, ROOT, ROOT);
  if (!classification) throw new Error(`unclassifiable: ${command}`);
  return classification.ask;
}

function editAsk(path: string, concern: 'escape' | 'sensitive'): PermissionAsk {
  return fileConcernAsk({
    operation: 'edit', path, root: ROOT, concern,
    ask: { type: 'permission', question: 'Edit?', risk: 'medium',
      metadata: { permissionKey: concern === 'escape' ? 'path:outside_workspace' : 'file_pattern:sensitive' } },
  });
}

describe('Prokop permission prompts', () => {
  let workspaceId: string;
  let sessionId: string;
  let messages: Array<{ type: string; requestId?: string }>;
  let calls = 0;

  beforeEach(() => {
    setupTestDatabase();
    ({ workspaceId, sessionId } = seedWorkspaceWithSession());
    messages = [];
  });
  afterEach(() => resetTestDatabase());

  function useMode(permissionMode: PermissionMode): void {
    sessionId = seedSession(workspaceId, { permissionMode }).id;
  }

  /** Runs one tool ask. When a prompt reaches the user, answers it with
   * `answer` (or lets it time out when none is given). */
  async function run(ask: PermissionAsk,
    options: { answer?: Grant; session?: string; root?: string; tool?: string } = {})
    : Promise<{ prompted: boolean; approved: boolean }> {
    const before = messages.length;
    const pending = requestPermission({
      sessionId: options.session ?? sessionId, rootSessionId: options.root, workspaceId, toolCallId: `call-${++calls}`,
      toolName: options.tool ?? 'shell', ask, broadcastFn: (m: unknown) => messages.push(m as never),
      timeoutMs: options.answer ? 5_000 : 30,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    const prompt = messages.slice(before).find(m => m.type === 'ask.request');
    if (prompt && options.answer) await resolvePermission(prompt.requestId!, { type: 'permission', grant: options.answer });
    const approved = await pending.then(value => value === true, () => false);
    return { prompted: !!prompt, approved };
  }

  describe('which commands prompt in each mode', () => {
    const cases: Array<[PermissionMode, string, boolean]> = [
      ['standard', 'ls ~/Documents', true],
      ['standard', 'cat ~/.ssh/config', true],
      ['extended', 'ls ~/Documents', false],
      ['extended', 'cat ~/.ssh/config', true],
      ['extended', 'git clean -fdx', true],
      ['full', 'git clean -fdx', false],
      ['full', 'cat ~/.ssh/config', false],
      ['full', 'rm -rf ~', true],
    ];
    for (const [mode, command, prompts] of cases) {
      test(`${mode}: ${command} ${prompts ? 'prompts' : 'runs without a prompt'}`, async () => {
        useMode(mode);
        expect((await run(shellAsk(command))).prompted).toBe(prompts);
      });
    }
  });

  describe('remembering a shell approval', () => {
    test('"this session" approval skips the prompt for the same command', async () => {
      expect(await run(shellAsk('cat ~/.ssh/config'), { answer: 'session' })).toEqual({ prompted: true, approved: true });
      expect(await run(shellAsk('cat ~/.ssh/config'))).toEqual({ prompted: false, approved: true });
    });

    test('"this session" approval does not cover a different command', async () => {
      await run(shellAsk('cat ~/.ssh/config'), { answer: 'session' });
      expect((await run(shellAsk('cat ~/.aws/credentials'))).prompted).toBe(true);
    });

    test('"this session" approval does not carry into another session', async () => {
      await run(shellAsk('cat ~/.ssh/config'), { answer: 'session' });
      const other = seedSession(workspaceId).id;
      expect((await run(shellAsk('cat ~/.ssh/config'), { session: other })).prompted).toBe(true);
    });

    test('"this workspace" approval carries into another session', async () => {
      await run(shellAsk('cat ~/.ssh/config'), { answer: 'workspace' });
      const other = seedSession(workspaceId).id;
      expect((await run(shellAsk('cat ~/.ssh/config'), { session: other })).prompted).toBe(false);
    });

    test('"this session" approval covers the session\'s subagents, and theirs covers the session', async () => {
      const child = seedSession(workspaceId, { parentId: sessionId }).id;
      await run(shellAsk('cat ~/.ssh/config'), { answer: 'session' });
      expect((await run(shellAsk('cat ~/.ssh/config'), { session: child, root: sessionId })).prompted).toBe(false);

      await run(shellAsk('cat ~/.ssh/known_hosts'), { answer: 'session', session: child, root: sessionId });
      expect((await run(shellAsk('cat ~/.ssh/known_hosts'))).prompted).toBe(false);
    });

    test('no remembered approval ever skips the prompt for a catastrophic command', async () => {
      await run(shellAsk('cat ~/.ssh/config'), { answer: 'workspace' });
      expect((await run(shellAsk('rm -rf ~'))).prompted).toBe(true);
    });

    test('a destructive command only offers "once", and a remembered answer is refused', async () => {
      const ask = shellAsk('git clean -fdx');
      expect(ask.allowedScopes).toEqual(['once']);
      expect(await run(ask, { answer: 'workspace' })).toEqual({ prompted: true, approved: false });
      expect((await run(shellAsk('git clean -fdx'))).prompted).toBe(true);
    });

    test('"once" approval is not remembered', async () => {
      await run(shellAsk('cat ~/.ssh/config'), { answer: 'once' });
      expect((await run(shellAsk('cat ~/.ssh/config'))).prompted).toBe(true);
    });

    test('deny blocks the command', async () => {
      expect(await run(shellAsk('cat ~/.ssh/config'), { answer: 'deny' })).toEqual({ prompted: true, approved: false });
    });
  });

  describe('remembering a terminal approval', () => {
    const terminalAsk = (cwd: string): PermissionAsk => ({
      ...createOutsideWorkspaceAsk({ command: `terminal create ${cwd}`, cwd, resolvedPaths: [cwd], hasOperators: false }),
      concerns: ['escape'], catastrophic: false,
    } as PermissionAsk);

    test('"this session" approval of an outside folder covers that folder only', async () => {
      await run(terminalAsk('/elsewhere/one'), { answer: 'session', tool: 'terminal' });
      expect((await run(terminalAsk('/elsewhere/one'), { tool: 'terminal' })).prompted).toBe(false);
      expect((await run(terminalAsk('/elsewhere/two'), { tool: 'terminal' })).prompted).toBe(true);
    });
  });

  describe('remembering a file approval', () => {
    test('"this session" approval skips the prompt for the same file', async () => {
      await run(editAsk('/elsewhere/a.txt', 'escape'), { answer: 'session', tool: 'edit' });
      expect((await run(editAsk('/elsewhere/a.txt', 'escape'), { tool: 'edit' })).prompted).toBe(false);
    });

    test('"this session" approval does not cover another outside file', async () => {
      await run(editAsk('/elsewhere/a.txt', 'escape'), { answer: 'session', tool: 'edit' });
      expect((await run(editAsk('/elsewhere/b.txt', 'escape'), { tool: 'edit' })).prompted).toBe(true);
    });

    test('approving an outside file does not cover a sensitive file', async () => {
      await run(editAsk('/elsewhere/a.txt', 'escape'), { answer: 'workspace', tool: 'edit' });
      expect((await run(editAsk(`${ROOT}/.env`, 'sensitive'), { tool: 'edit' })).prompted).toBe(true);
    });
  });
});

describe('Prokop asks wait for an answer', () => {
  let workspaceId: string;
  let sessionId: string;
  beforeEach(() => {
    setupTestDatabase();
    ({ workspaceId, sessionId } = seedWorkspaceWithSession());
  });
  afterEach(async () => {
    await rejectPendingAsksBySession(sessionId);
    resetTestDatabase();
  });

  /** Raises one ask from a tool and returns how long it may wait and whether it pushed. */
  async function raise(ask: Ask): Promise<{ waitMs: number; pushed: boolean }> {
    const notify = spyOn(getRuntimeHost().interaction, 'notifyAnswerRequired').mockResolvedValue(undefined);
    try {
      void createAskApi(sessionId, `call-${ask.type}`, 'tool', () => {}, workspaceId, sessionId)(ask).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 10));
      const [record] = listPendingAsksBySession(sessionId);
      return { waitMs: record!.expiresAt! - record!.createdAt, pushed: notify.mock.calls.length > 0 };
    } finally {
      notify.mockRestore();
    }
  }

  test('a tool approval waits the full permission timeout and pushes', async () => {
    expect(await raise(shellAsk('cat ~/.ssh/config'))).toEqual({ waitMs: getPermissionTimeoutMs(), pushed: true });
  });

  test('a question waits as long as an approval and pushes', async () => {
    const question = { type: 'text', target: 'human', question: 'Which branch?' } as Ask;
    expect(await raise(question)).toEqual({ waitMs: getPermissionTimeoutMs(), pushed: true });
  });

  test('a browser extension request keeps its short limit and never pushes', async () => {
    const capability = { type: 'client_capability', target: 'client', capability: 'browser.read_active_tab', params: {} } as unknown as Ask;
    expect(await raise(capability)).toEqual({ waitMs: ASK_TIMEOUT, pushed: false });
  });
});
