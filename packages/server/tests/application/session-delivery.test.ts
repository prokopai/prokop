import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { QueuedMessage, ServerMessage, Session } from '@prokopai/sdk';
import type { SessionWirePorts } from '@prokopai/core/application/ports/delivery';
import { createSessionDeliveryApplication, type SessionDeliveryApplication } from '@/application/sessions/delivery';
import { addSessionUpdatedObserver } from '@/application/sessions/updates';
import { createSessionDeliveryRepository } from '@/infrastructure/sqlite/session-deliveries';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { deleteSession, getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspaceWithSession } from '#tests/seed';

type Origin = string;

interface TurnCall {
  sessionId: string;
  content: string;
  origin: Origin;
  wire: SessionWirePorts<Origin>;
}

describe('server-originated session delivery', () => {
  let application: SessionDeliveryApplication;
  let turns: TurnCall[];
  let queued: Array<{ sessionId: string; content: string; steer: boolean }>;
  let drained: string[];
  let broadcasts: Array<{ sessionId: string; message: ServerMessage }>;
  let active: Set<string>;
  /** What `sendMessage` does once called: run (resolve) or report an error on the wire first. */
  let turnBehavior: (call: TurnCall) => Promise<void>;
  let detach: () => void;
  let sessionId: string;

  beforeEach(() => {
    setupTestDatabase();
    ({ sessionId } = seedWorkspaceWithSession());
    turns = [];
    queued = [];
    drained = [];
    broadcasts = [];
    active = new Set();
    turnBehavior = async () => {};
    application = createSessionDeliveryApplication<Origin>({
      repository: createSessionDeliveryRepository(getDatabase),
      sessions: {
        getSession: (id) => getSession(id),
        addMessageToQueue: (id, content, _attachments, steer) => {
          queued.push({ sessionId: id, content, steer: steer === true });
          return { id: `q-${queued.length}`, sessionId: id, content, createdAt: Date.now(), steer: steer === true } as QueuedMessage;
        },
      },
      execution: {
        isSessionActive: (id) => active.has(id),
        sendMessage: async (wire, origin, id, content) => {
          // The port is generic over the origin; this fake only ever sees strings.
          const call: TurnCall = { sessionId: id, content, origin: origin as unknown as Origin, wire: wire as unknown as SessionWirePorts<Origin> };
          turns.push(call);
          await turnBehavior(call);
        },
        drainQueue: async (_wire, _origin, id) => {
          drained.push(id);
        },
      },
      delivery: {
        broadcast: () => {},
        broadcastToSession: (id, message) => broadcasts.push({ sessionId: id, message }),
        sendToController: () => {},
        sendToAskTargets: () => {},
      },
      originFor: (key) => `delivery:${key}`,
    });
    detach = addSessionUpdatedObserver(application.onSessionUpdated);
  });

  afterEach(() => {
    detach();
    resetTestDatabase();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  test('an idle session starts a turn with the message under a delivery origin', async () => {
    const outcome = await application.deliver({ sessionId, content: 'task 1 finished', key: 'task-result:1', origin: 'delegation' });

    expect(outcome).toBe('started');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ sessionId, content: 'task 1 finished', origin: 'delivery:task-result:1' });
    expect(queued).toEqual([]);
    const row = getDatabase().query('SELECT state, attempts FROM session_deliveries WHERE delivery_key = ?').get('task-result:1');
    expect(row).toEqual({ state: 'delivered', attempts: 1 });
  });

  test('the same key delivers once, however often it is sent', async () => {
    await application.deliver({ sessionId, content: 'hello', key: 'call-1', origin: 'agent' });
    expect(await application.deliver({ sessionId, content: 'hello again', key: 'call-1', origin: 'agent' })).toBe('duplicate');
    expect(turns).toHaveLength(1);
  });

  test('a busy session gets the message through its queue, steered when asked', async () => {
    active.add(sessionId);

    expect(await application.deliver({ sessionId, content: 'later', key: 'k1', origin: 'group' })).toBe('queued');
    expect(await application.deliver({ sessionId, content: 'now', key: 'k2', origin: 'group', steer: true })).toBe('queued');

    expect(turns).toEqual([]);
    expect(queued).toEqual([
      { sessionId, content: 'later', steer: false },
      { sessionId, content: 'now', steer: true },
    ]);
    expect(broadcasts.map((entry) => entry.message.type)).toEqual(['queue.added', 'queue.added']);
    // A Prokop session drains after its own turn; no wake-up needed.
    expect(drained).toEqual([]);
  });

  test('a CLI session, even a child one, is woken to drain the queued delivery', async () => {
    const child = seedSession('ws1', { id: 'child-1', harness: 'claude-cli', parentId: sessionId });
    updateSession(child.id, { runningAt: new Date().toISOString() });

    expect(await application.deliver({ sessionId: child.id, content: 'result', key: 'k-child', origin: 'delegation' })).toBe('queued');
    expect(queued).toEqual([{ sessionId: child.id, content: 'result', steer: false }]);
    expect(drained).toEqual([child.id]);
  });

  test('a busy answer on the wire falls back to the queue', async () => {
    turnBehavior = async (call) => {
      call.wire.delivery.send(call.origin, { type: 'error', code: 'session_busy', message: 'Session is busy', sessionId });
    };

    expect(await application.deliver({ sessionId, content: 'race', key: 'k-race', origin: 'delegation' })).toBe('queued');
    expect(queued).toEqual([{ sessionId, content: 'race', steer: false }]);
  });

  test('a compacting session keeps the delivery pending and takes it once compaction ends', async () => {
    updateSession(sessionId, { compacting: true });

    expect(await application.deliver({ sessionId, content: 'after compaction', key: 'k-compact', origin: 'agent' })).toBe('pending');
    expect(turns).toEqual([]);
    expect(getDatabase().query('SELECT state, last_error FROM session_deliveries WHERE delivery_key = ?').get('k-compact'))
      .toEqual({ state: 'pending', last_error: 'Session is compacting' });

    // Still busy after compaction: nothing happens on that update.
    updateSession(sessionId, { compacting: false, runningAt: new Date().toISOString() });
    await settle();
    expect(turns).toEqual([]);
    expect(queued).toEqual([]);

    updateSession(sessionId, { runningAt: null });
    await settle();
    expect(turns).toHaveLength(1);
    expect(turns[0]?.content).toBe('after compaction');
    expect(getDatabase().query('SELECT state FROM session_deliveries WHERE delivery_key = ?').get('k-compact')).toEqual({ state: 'delivered' });
  });

  test('a closed session waits; a deleted session drops the delivery', async () => {
    updateSession(sessionId, { status: 'closed' });
    expect(await application.deliver({ sessionId, content: 'x', key: 'k-archived', origin: 'agent' })).toBe('pending');

    updateSession(sessionId, { status: 'active' });
    await settle();
    expect(turns).toHaveLength(1);

    const other = seedSession('ws1', { id: 'gone-soon' });
    updateSession(other.id, { compacting: true });
    expect(await application.deliver({ sessionId: other.id, content: 'y', key: 'k-gone', origin: 'agent' })).toBe('pending');
    deleteSession(other.id);
    // The row went with the session (cascade); a retry finds nothing to do.
    await application.retryAll();
    expect(getDatabase().query('SELECT COUNT(*) AS count FROM session_deliveries WHERE delivery_key = ?').get('k-gone')).toEqual({ count: 0 });
    expect(turns).toHaveLength(1);
  });

  test('a turn that fails to start is retried on the next idle update, not polled', async () => {
    let fail = true;
    turnBehavior = async (call) => {
      if (fail) call.wire.delivery.send(call.origin, { type: 'error', code: 'invalid_session', message: 'Harness unavailable', sessionId });
    };

    expect(await application.deliver({ sessionId, content: 'fragile', key: 'k-fragile', origin: 'delegation' })).toBe('pending');
    expect(getDatabase().query('SELECT state, attempts, last_error FROM session_deliveries WHERE delivery_key = ?').get('k-fragile'))
      .toEqual({ state: 'pending', attempts: 1, last_error: 'Harness unavailable' });

    fail = false;
    updateSession(sessionId, { title: 'renamed, still idle' });
    await settle();
    expect(turns).toHaveLength(2);
    expect(getDatabase().query('SELECT state FROM session_deliveries WHERE delivery_key = ?').get('k-fragile')).toEqual({ state: 'delivered' });
  });

  test('startup retries what the previous process left pending, once per session in order', async () => {
    const session = getSession(sessionId) as Session;
    updateSession(session.id, { compacting: true });
    await application.deliver({ sessionId, content: 'first', key: 'k-a', origin: 'group' });
    await application.deliver({ sessionId, content: 'second', key: 'k-b', origin: 'group' });
    detach();
    updateSession(sessionId, { compacting: false });

    // The second attempt sees the first turn running (the fake marks it active).
    turnBehavior = async (call) => { active.add(call.sessionId); };
    await application.retryAll();
    await settle();

    expect(turns.map((turn) => turn.content)).toEqual(['first']);
    expect(queued.map((entry) => entry.content)).toEqual(['second']);
  });
});
