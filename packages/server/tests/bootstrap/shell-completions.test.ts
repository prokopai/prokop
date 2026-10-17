import { describe, expect, test } from 'bun:test';
import type { QueuedMessage, ServerMessage, Session } from '@prokopai/sdk';
import type { ShellCompletionPort } from '@prokopai/agent';
import { installShellCompletionDelivery, type ShellCompletionDeliveryDeps } from '@/bootstrap/shell-completions';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1', harness: 'prokop', status: 'active', workspaceId: 'ws-1',
    title: 'Build', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  } as Session;
}

function harness(overrides: { session?: Session | null; active?: boolean } = {}) {
  let installed: ShellCompletionPort | null = null;
  const killed: string[] = [];
  const queued: Array<{ sessionId: string; content: string; steer?: boolean }> = [];
  const sent: Array<{ origin: string; sessionId: string; content: string }> = [];
  const broadcasts: Array<{ sessionId: string; message: ServerMessage }> = [];
  const deps: ShellCompletionDeliveryDeps = {
    runtime: {
      configureShellCompletions: (port) => { installed = port; },
      killShellCommandsForSession: async (sessionId) => { killed.push(sessionId); },
    },
    repository: {
      getSession: () => overrides.session === undefined ? session() : overrides.session,
      addMessageToQueue: (sessionId, content, _attachments, steer) => {
        queued.push({ sessionId, content, steer });
        return { id: 'q-1', sessionId, content, position: 1, createdAt: Date.now(), ...(steer ? { steer: true } : {}) } as QueuedMessage;
      },
    },
    execution: {
      isSessionActive: () => overrides.active ?? false,
      sendMessage: async (wire, origin, sessionId, content) => {
        sent.push({ origin: String(origin), sessionId, content });
        wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: session() });
      },
    },
    delivery: {
      broadcast: () => {},
      broadcastToSession: (sessionId, message) => { broadcasts.push({ sessionId, message }); },
      sendToController: () => {},
      sendToAskTargets: () => {},
    },
  };
  const delivery = installShellCompletionDelivery(deps);
  return { delivery, port: () => installed!, killed, queued, sent, broadcasts };
}

describe('shell completion delivery', () => {
  test('installs the port into the agent runtime', () => {
    const h = harness();
    expect(h.port()).toBe(h.delivery.port);
  });

  test('an idle session gets a new turn through a session-wide wire', async () => {
    const h = harness({ active: false });
    await h.port().deliver('session-1', 'Background command sh-1 finished');
    expect(h.sent).toEqual([{ origin: 'shell:session-1', sessionId: 'session-1', content: 'Background command sh-1 finished' }]);
    expect(h.queued).toEqual([]);
    // What the turn broadcasts still reaches the session's clients.
    expect(h.broadcasts.map((entry) => entry.message.type)).toEqual(['session.updated']);
  });

  test('a running turn gets a steer row and clients see it queued', async () => {
    const h = harness({ active: true });
    await h.port().deliver('session-1', 'done');
    expect(h.sent).toEqual([]);
    expect(h.queued).toEqual([{ sessionId: 'session-1', content: 'done', steer: true }]);
    expect(h.broadcasts).toEqual([{ sessionId: 'session-1', message: { type: 'queue.added', sessionId: 'session-1',
      message: expect.objectContaining({ id: 'q-1', steer: true }) } }]);
  });

  test.each([
    ['missing', null],
    ['archived', session({ status: 'closed' })],
    ['a child session', session({ parentId: 'parent' })],
    ['another harness', session({ harness: 'claude-cli' })],
  ])('%s sessions are left alone', async (_label, value) => {
    const h = harness({ session: value, active: false });
    await h.port().deliver('session-1', 'done');
    expect(h.sent).toEqual([]);
    expect(h.queued).toEqual([]);
  });

  test('an ended session has its commands killed', () => {
    const h = harness();
    h.delivery.stopBackgroundWork('session-1');
    expect(h.killed).toEqual(['session-1']);
  });
});
