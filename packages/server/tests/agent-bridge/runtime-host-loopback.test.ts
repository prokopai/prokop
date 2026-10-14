import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { prokopCompatibilityBindings } from '@/adapters/prokop/runtime-host/bindings';
import { prokopStorageBundle } from '@/adapters/prokop/runtime-host/storage';
import { getRuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { listPendingAsksBySession } from '@/infrastructure/sqlite/pending-asks';
import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { resetTestDatabase, restoreConfiguredRuntime, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

/**
 * Production wiring with PROKOPAI_AGENT_LOOPBACK=1: bootstrap swaps the
 * Prokop storage and runtime host for protocol-backed ones whose host side is
 * the real SQLite adapters.
 */
describe('Prokop runtime host over the agent protocol loopback (SQLite)', () => {
  beforeEach(() => {
    process.env.PROKOPAI_AGENT_LOOPBACK = '1';
    setupTestDatabase();
    seedWorkspace();
  });

  afterEach(() => {
    delete process.env.PROKOPAI_AGENT_LOOPBACK;
    restoreConfiguredRuntime();
    resetTestDatabase();
  });

  test('bootstrap installs protocol-backed storage and runtime host', () => {
    expect(getStorage()).not.toBe(prokopStorageBundle);
    expect(getRuntimeHost()).not.toBe(prokopCompatibilityBindings);
  });

  test('a pending ask created by the agent lands in the host SQLite table', async () => {
    const session = seedSession('ws1', { id: 's1' });
    const id = await getRuntimeHost().interaction.createPendingAsk({
      requestId: 'r1', sessionId: session.id, rootSessionId: session.id, workspaceId: 'ws1',
      toolCallId: 'call-1', toolName: 'shell',
      ask: { type: 'permission', question: 'Run ls?', risk: 'low', resource: 'shell-command', action: 'execute' },
      status: 'pending', isPermission: true, createdAt: Date.now(),
    });
    expect(listPendingAsksBySession(session.id).map(record => record.id)).toEqual([id]);

    expect(await getRuntimeHost().interaction.resolvePermissionRequestByRequestId('r1', 'approved', { grant: 'once' })).toBe(true);
    expect(await getRuntimeHost().interaction.resolvePermissionRequestByRequestId('r1', 'denied')).toBe(false);
    expect(await getRuntimeHost().interaction.getPermissionRequestByRequestId('r1')).toMatchObject({ status: 'approved' });
  });

  test('worktree resolution errors reach the agent with the host message', async () => {
    await expect(getRuntimeHost().workspace.resolveSessionWorkspace!({
      sessionId: 's1', workspaceId: 'ws1', workspaceRootId: 'no-such-worktree',
    })).rejects.toThrow('Selected worktree is not available for this workspace');
  });

  test('tool read roots include the agent directory once the agent has read the session', async () => {
    seedSession('ws1', { id: 's1', agentId: 'agent-7' });
    const before = getRuntimeHost().workspace.createToolWorkspaceHost({ sessionId: 's1', workspaceId: 'ws1', workspacePath: '/test' });
    // Not read yet: fewer read roots, never more.
    expect(before.allowedRoots?.length).toBe(1);

    await getStorage().conversation.getSession('s1');
    const after = getRuntimeHost().workspace.createToolWorkspaceHost({ sessionId: 's1', workspaceId: 'ws1', workspacePath: '/test' });
    expect(after.allowedRoots).toEqual(prokopCompatibilityBindings.workspace.createToolWorkspaceHost({
      sessionId: 's1', workspaceId: 'ws1', workspacePath: '/test',
    }).allowedRoots);
    expect(after.allowedRoots?.length).toBe(2);
  });
});
