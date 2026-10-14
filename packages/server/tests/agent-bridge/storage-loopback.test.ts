import { afterEach, describe, expect, test } from 'bun:test';
import type { ToolPart } from '@prokopai/sdk/types';
import { createLoopbackStorage } from '@/agent-bridge/loopback';
import { prokopStorageBundle } from '@/harnesses/prokop/host/storage';
import type { StorageBundle } from '@/infrastructure/storage/contracts';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import {
  createTestAssistantMessage, createTestSession, createTestTextPart, createTestToolPart, createTestUserMessage,
} from '#tests/factories';
import { seedWorkspace } from '#tests/seed';

const TIME_KEYS = new Set(['createdAt', 'updatedAt', 'startedAt', 'interruptedAt', 'completedAt', 'runningAt']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JSON view with clock values and generated IDs masked, so two runs compare. */
function normalize(value: unknown): unknown {
  const json = value === undefined ? null : JSON.parse(JSON.stringify(value)) as unknown;
  const mask = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(mask);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, item]) =>
        [key, TIME_KEYS.has(key) && item !== null ? '<time>' : mask(item)]));
    }
    return typeof node === 'string' && UUID.test(node) ? '<uuid>' : node;
  };
  return mask(json);
}

/** Calls every StorageBundle method once, in an order the engine also uses. */
async function storageScript(storage: StorageBundle, workspaceId: string): Promise<Array<[string, unknown]>> {
  const steps: Array<[string, unknown]> = [];
  const step = async (name: string, run: () => Promise<unknown>): Promise<unknown> => {
    const result = await run();
    steps.push([name, normalize(result)]);
    return result;
  };
  const { conversation, queue } = storage;
  const { createdAt: _c, updatedAt: _u, ...session } = createTestSession({ id: 's1', workspaceId });
  const { createdAt: _cc, updatedAt: _cu, ...child } = createTestSession({ id: 's2', workspaceId, parentId: 's1', agentName: 'helper' });
  const user = createTestUserMessage('s1', { id: 'm1', createdAt: 1 });
  const assistant = createTestAssistantMessage('s1', { id: 'm2', parentId: 'm1', status: 'streaming', createdAt: 2 });
  const tool: ToolPart = createTestToolPart('m2', { id: 'p3', callId: 'call-1', createdAt: 12 });

  await step('createSession', () => conversation.createSession(session));
  await step('createSession child', () => conversation.createSession(child));
  await step('getSession', () => conversation.getSession('s1'));
  await step('getSession missing', () => conversation.getSession('missing'));
  await step('updateSession', () => conversation.updateSession('s1', { title: 'Renamed', metadata: { a: 1 } }));
  await step('getChildSessions', () => conversation.getChildSessions('s1'));

  await step('createMessage user', () => conversation.createMessage(user));
  await step('createMessage assistant', () => conversation.createMessage(assistant));
  await step('createPart text', () => conversation.createPart(createTestTextPart('m1', 'hello', { id: 'p1', createdAt: 10 }), 's1'));
  await step('createPart answer', () => conversation.createPart(createTestTextPart('m2', '', { id: 'p2', createdAt: 11 }), 's1'));
  await step('createPart tool', () => conversation.createPart(tool, 's1'));
  await step('getMessage', () => conversation.getMessage('m2'));
  await step('getMessageWithParts', () => conversation.getMessageWithParts('m2'));
  await step('persistStreamingPartSnapshots', () => conversation.persistStreamingPartSnapshots([
    { id: 'p2', messageId: 'm2', sessionId: 's1', type: 'text', createdAt: 11, text: 'streamed so far' },
  ]));
  await step('transitionToolToRunningByCallId', () => conversation.transitionToolToRunningByCallId('s1', 'call-1'));
  await step('transitionToolToInterrupted', () => conversation.transitionToolToInterrupted('p3', 'user_request'));
  await step('updatePart', () => conversation.updatePart('p2', { text: 'final answer' }));
  await step('getPart', () => conversation.getPart('p2'));
  await step('getPartsByMessage', () => conversation.getPartsByMessage('m2'));
  await step('getPartsBySession', () => conversation.getPartsBySession('s1'));
  await step('updateMessage', () => conversation.updateMessage('m2', { status: 'completed' }));
  await step('listMessagesWithParts', () => conversation.listMessagesWithParts('s1'));
  await step('listLatestMessagesWithPartsPage', () => conversation.listLatestMessagesWithPartsPage('s1', 1));
  await step('buildEffectiveContextHistory', () => conversation.buildEffectiveContextHistory('s1'));
  await step('index.syncMessage', () => storage.index.syncMessage('m2'));

  const artifact = await step('toolOutputArtifacts.create', () => storage.toolOutputArtifacts.create({
    sessionId: 's1', workspaceId, toolCallId: 'call-1', toolName: 'test-tool', content: 'x'.repeat(30), format: 'text',
  })) as { id: string };
  await step('toolOutputArtifacts.getPage', () => storage.toolOutputArtifacts.getPage('s1', artifact.id, 5, 10));

  const queued = await step('queue.addMessage', () => queue.addMessage('s1', 'next prompt')) as { id: string };
  await step('queue.peek', () => queue.peek('s1'));
  await step('queue.peekSteer', () => queue.peekSteer('s1'));
  await step('queue.delete', () => queue.delete(queued.id));
  await step('queue.peek empty', () => queue.peek('s1'));

  await step('deleteMessage', () => conversation.deleteMessage('m2'));
  await step('deleteMessage missing', () => conversation.deleteMessage('m2'));
  await step('listMessagesWithParts after delete', () => conversation.listMessagesWithParts('s1'));
  await step('attachments.get missing', () => storage.attachments.get('s1', 'missing'));
  await step('workspaces.get', () => storage.workspaces.get(workspaceId));
  await step('responseFormats.get missing', () => storage.responseFormats.get('missing'));
  return steps;
}

/** Guards against a vacuous comparison: the script must really read back what it wrote. */
function expectRealResults(steps: Array<[string, unknown]>): void {
  const result = (name: string): unknown => steps.find(([step]) => step === name)?.[1];
  expect(steps).toHaveLength(38);
  expect(result('getPart')).toMatchObject({ id: 'p2', text: 'final answer' });
  expect(result('transitionToolToInterrupted')).toMatchObject({ state: { status: 'interrupted', reason: 'user_request' } });
  expect(result('listMessagesWithParts')).toMatchObject([{ message: { id: 'm1' } }, { message: { id: 'm2', status: 'completed' } }]);
  expect(result('toolOutputArtifacts.getPage')).toMatchObject({ content: 'xxxxxxxxxx', nextOffset: 15 });
  expect(result('queue.peek')).toMatchObject({ content: 'next prompt' });
  expect(result('deleteMessage')).toBe(true);
  expect(result('deleteMessage missing')).toBe(false);
}

describe('storage over the agent protocol loopback', () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });

  const loopback = (bundle: StorageBundle): StorageBundle => {
    const { storage, close } = createLoopbackStorage(bundle);
    closers.push(close);
    return storage;
  };

  test('in-memory bundle: every method returns the same through the loopback', async () => {
    const direct = await storageScript(createInMemoryStorageBundle(), 'w1');
    const viaProtocol = await storageScript(loopback(createInMemoryStorageBundle()), 'w1');
    expectRealResults(direct);
    expect(viaProtocol).toEqual(direct);
  });

  test('SQLite bundle: every method returns the same through the loopback', async () => {
    setupTestDatabase();
    seedWorkspace();
    const direct = await storageScript(prokopStorageBundle, 'ws1');
    resetTestDatabase();

    setupTestDatabase();
    seedWorkspace();
    const viaProtocol = await storageScript(loopback(prokopStorageBundle), 'ws1');
    resetTestDatabase();

    expectRealResults(direct);
    expect(viaProtocol).toEqual(direct);
  });

  test('host errors reach the engine as rejections with the host message', async () => {
    const storage = loopback(createInMemoryStorageBundle());
    await expect(storage.conversation.createMessage(createTestUserMessage('no-such-session', { id: 'm1' })))
      .rejects.toThrow('Session does not exist: no-such-session');
  });
});
