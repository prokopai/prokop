import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AssistantMessage, ServerMessage } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@prokopai/core/application/ports/delivery';
import {
  bindCodexThread, getCodexBinding, markCodexSteerReply, markCodexTurnPending, markCodexTurnStarted,
} from '@prokopai/agent/internal/harnesses/codex-cli/bindings';
import { commitSteer } from '@prokopai/agent/internal/harnesses/shared/steering';
import { prokopStorageBundle } from '@/adapters/prokop/runtime-host/storage';
import { createMessage, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { addMessageToQueue, listQueuedMessages } from '@/infrastructure/sqlite/queued-messages';
import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { storeTransaction } from '@prokopai/core/infrastructure/storage/transaction';
import { resetTestDatabase, restoreConfiguredRuntime, setupTestDatabase } from '#tests/db';
import { codexBinding } from '#tests/helpers/legacy-native';
import { seedSession, seedWorkspace } from '#tests/seed';

/**
 * With PROKOPAI_AGENT_LOOPBACK=1, Claude Code and Codex native state and
 * their atomic writes reach SQLite only through `native.*` and `store.commit`.
 */
describe('native harness state over the agent protocol loopback (SQLite)', () => {
  beforeEach(() => {
    process.env.PROKOPAI_AGENT_LOOPBACK = '1';
    setupTestDatabase();
    seedWorkspace();
    seedSession('ws1', { id: 's1', harness: 'codex-cli' });
  });

  afterEach(() => {
    delete process.env.PROKOPAI_AGENT_LOOPBACK;
    restoreConfiguredRuntime();
    resetTestDatabase();
  });

  test('the harness storage is protocol-backed', () => {
    expect(getStorage()).not.toBe(prokopStorageBundle);
  });

  test('a Codex turn lifecycle writes the binding through store.commit', async () => {
    await bindCodexThread({ sessionId: 's1', threadId: 'thread-1', cliVersion: '0.161.0', workspaceRoot: '/w' });
    await storeTransaction(tx => markCodexTurnPending(tx, 's1', 'user-1', 'assistant-1'));
    await markCodexTurnStarted('s1', 'turn-1', 'assistant-1', false);
    expect(codexBinding('s1')).toMatchObject({ threadId: 'thread-1', pendingTurn: true,
      pendingUserId: 'user-1', pendingTurnId: 'turn-1', goalRootTurnId: 'turn-1' });
    expect(await getCodexBinding('s1')).toEqual(codexBinding('s1'));

    // Guards decided on the value read still fail closed with the harness error.
    await expect(storeTransaction(tx => markCodexTurnPending(tx, 's1', 'user-2', 'assistant-2')))
      .rejects.toThrow('Codex turn requires reconciliation before another send');
    seedSession('ws1', { id: 's2', harness: 'codex-cli' });
    await expect(bindCodexThread({ sessionId: 's2', threadId: 'thread-1', cliVersion: '0.161.0', workspaceRoot: '/w' }))
      .rejects.toThrow('UNIQUE constraint failed');
    await expect(bindCodexThread({ sessionId: 'missing', threadId: 'thread-2', cliVersion: '0.161.0', workspaceRoot: '/w' }))
      .rejects.toThrow('Codex session no longer exists');
  });

  test('a steer commits the queue row, transcript and Codex reply in one commit', async () => {
    await bindCodexThread({ sessionId: 's1', threadId: 'thread-1', cliVersion: '0.161.0', workspaceRoot: '/w' });
    await storeTransaction(tx => markCodexTurnPending(tx, 's1', 'user-1', 'assistant-1'));
    createMessage({ id: 'assistant-1', sessionId: 's1', role: 'assistant', status: 'streaming', modelId: 'm',
      providerId: 'codex-cli', tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: 1 });
    const queued = addMessageToQueue('s1', 'use tabs', undefined, true);
    const delivered: ServerMessage[] = [];
    const delivery = { broadcastToSession: (_id: string, message: ServerMessage) => { delivered.push(message); } } as
      unknown as ApplicationDeliveryPort<unknown>;
    const next: AssistantMessage = { id: 'assistant-2', sessionId: 's1', role: 'assistant', status: 'streaming',
      modelId: 'm', providerId: 'codex-cli', tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: Date.now() + 1 };

    await commitSteer(delivery, 's1', { queued, userMessageId: 'steer-1', images: [] }, async (tx) => {
      tx.write({ op: 'message.update', id: 'assistant-1', updates: { status: 'completed' } });
      tx.write({ op: 'message.create', message: next });
      await markCodexSteerReply(tx, 's1', next.id);
    });

    expect(listQueuedMessages('s1')).toEqual([]);
    expect(listMessagesWithParts('s1').map(entry => [entry.message.id, entry.message.role === 'assistant'
      ? entry.message.status : entry.parts.map(part => part.type === 'text' ? part.text : part.type)]))
      .toEqual([['assistant-1', 'completed'], ['steer-1', ['use tabs']], ['assistant-2', 'streaming']]);
    expect(codexBinding('s1')?.pendingAssistantId).toBe('assistant-2');
    expect(delivered.map(message => message.type)).toEqual(['queue.sending', 'message.created', 'part.created']);
  });

  test('a failed write inside a steer commit leaves nothing behind', async () => {
    const queued = addMessageToQueue('s1', 'use tabs', undefined, true);
    const delivery = { broadcastToSession: () => {} } as unknown as ApplicationDeliveryPort<unknown>;
    // No binding: the Codex steer reply has no pending turn and the whole commit refuses.
    await expect(commitSteer(delivery, 's1', { queued, userMessageId: 'steer-1', images: [] },
      tx => markCodexSteerReply(tx, 's1', 'assistant-2'))).rejects.toThrow('Codex steer has no pending turn');
    expect(listQueuedMessages('s1')).toHaveLength(1);
    expect(listMessagesWithParts('s1')).toEqual([]);
  });
});
