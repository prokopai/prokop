import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerMessage } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { getAgentAskPort } from '@/application/ports/agent-asks';
import { codexApprovals } from '@/harnesses/codex-cli/approvals';
import { harnessAsks } from '@/infrastructure/runtime/harness-asks';
import { getPermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { matchGrant } from '@/infrastructure/sqlite/permissions';
import { resetTestDatabase, restoreConfiguredRuntime, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

/**
 * With PROKOPAI_AGENT_LOOPBACK=1, a native harness approval stores its row
 * through `interaction.*` and the user's answer reaches the waiter as
 * `ask.resolve`; the remembered grant is stored with the resolution.
 */
describe('harness asks over the agent protocol loopback (SQLite)', () => {
  beforeEach(() => {
    process.env.PROKOPAI_AGENT_LOOPBACK = '1';
    setupTestDatabase();
    seedWorkspace();
    seedSession('ws1', { id: 's1', harness: 'codex-cli', permissionMode: 'standard' });
  });

  afterEach(() => {
    delete process.env.PROKOPAI_AGENT_LOOPBACK;
    codexApprovals.cancelSession('s1');
    restoreConfiguredRuntime();
    resetTestDatabase();
  });

  test('an approval round-trips: row via interaction.*, answer via ask.resolve, grant stored', async () => {
    const messages: ServerMessage[] = [];
    const delivery = {
      sendToAskTargets: (_id: string, _authority: unknown, message: ServerMessage) => { messages.push(message); },
      broadcastToSession: (_id: string, message: ServerMessage) => { messages.push(message); },
    } as unknown as ApplicationDeliveryPort<unknown>;
    const params = { threadId: 't', turnId: 'turn', itemId: 'item-1', command: 'cat /etc/hosts', cwd: process.cwd() };
    const decision = codexApprovals.request('item/commandExecution/requestApproval', params, 't', 'turn', 's1',
      process.cwd(), 'ws1', delivery);
    for (let attempt = 0; attempt < 100 && !messages.some(message => message.type === 'ask.request'); attempt++) {
      await Bun.sleep(1);
    }
    const ask = messages.find(message => message.type === 'ask.request') as Extract<ServerMessage, { type: 'ask.request' }>;
    expect(getPermissionRequestByRequestId(ask.requestId!)).toMatchObject({ status: 'pending', rootSessionId: 's1' });

    const port = getAgentAskPort()!;
    // The host knows the connected agent holds this waiter (pending-ask listing must not expire it).
    expect(port.hasLiveRequest(ask.requestId!)).toBe(true);
    expect(port.hasLiveRequest('other-request')).toBe(false);
    expect(await port.lookup(ask.toolCallId, ask.requestId)).toEqual({ sessionId: 's1',
      authority: { visibilityScope: 'controller_only', resolutionMode: 'controller_only' } });
    expect(await port.lookup(ask.toolCallId, 'wrong')).toBeNull();
    expect(await port.resolve({ sessionId: 's1', toolCallId: ask.toolCallId, requestId: 'wrong',
      response: { type: 'permission', grant: 'once' } })).toBe(false);
    expect(await port.resolve({ sessionId: 's1', toolCallId: ask.toolCallId, requestId: ask.requestId,
      response: { type: 'permission', grant: 'workspace' } })).toBe(true);
    expect(await decision).toEqual({ decision: 'accept' });
    expect(getPermissionRequestByRequestId(ask.requestId!)).toMatchObject({ status: 'approved' });
    expect(matchGrant({ workspaceId: 'ws1', toolName: 'codex-cli:command', resource: 'shell-command',
      action: 'execute', permissionKey: JSON.stringify([process.cwd(), 'cat /etc/hosts']), rootSessionId: 's1' }))
      .toMatchObject({ matched: true, grant: { scope: 'workspace' } });
  });

  test('the store answers control and a lost row resolves false', async () => {
    expect(await harnessAsks().sessionControl('s1')).toEqual({ controlled: false, connected: false });
    expect(await harnessAsks().resolveRequest('missing', 'approved', null)).toEqual({ resolved: false, status: 'approved' });
  });
});
