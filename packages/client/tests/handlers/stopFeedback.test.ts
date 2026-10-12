import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Message, Session } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage/types';

vi.mock('@/components/providers/QueryProvider', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { handleSessionInterrupted, handleSessionUpdated } from '@/handlers/serverMessage/sessionHandlers';
import { handleError, handleMessageCreated } from '@/handlers/serverMessage/messagePartHandlers';
import { useConnectionStore } from '@/stores/connectionStore';

const runningAt = '2026-10-12T10:00:00.000Z';
const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's', workspaceId: 'ws', parentId: null, status: 'active', title: 'Run', tags: [],
  runningAt, metadata: null, updatedAt: runningAt, ...overrides,
}) as Session;

function context(initial: Session[]): SessionHandlersContext {
  let sessions = initial;
  return {
    sessionsRef: { get current() { return sessions; } },
    setSessions: vi.fn((updater: (prev: Session[]) => Session[]) => { sessions = updater(sessions); }),
    setModelForSession: vi.fn(),
    setVariantForSession: vi.fn(),
    setMessagesBySession: vi.fn(),
    setPartsBySession: vi.fn(),
    addStreamingSession: vi.fn(),
    removeStreamingSession: vi.fn(),
    addInterruptedSession: vi.fn(),
    removeInterruptedSession: vi.fn(),
    clearCompletion: vi.fn(),
    clearPendingAskRequestsBySessionId: vi.fn(),
    skipFinishSoundSessionIdsRef: { current: new Set<string>() },
  } as unknown as SessionHandlersContext;
}

const stopping = () => useConnectionStore.getState().stoppingSessionIds.has('s');
const interrupted = (success: boolean) => ({ type: 'session.interrupted' as const, sessionId: 's',
  result: { sessionId: 's', success, cascadedTo: [], interruptedTools: [], rejectedAsks: [] } });

describe('Stop reads idle at once and follows the server after', () => {
  beforeEach(() => {
    useConnectionStore.setState({ stoppingSessionIds: new Set() });
    useConnectionStore.getState().markSessionStopping('s');
  });

  test('a stopped run stays idle while it winds down and clears when the server ends it', () => {
    const ctx = context([session()]);
    handleSessionInterrupted(interrupted(true), ctx);
    // Token usage and other updates of the ending run do not bring Stop back.
    handleSessionUpdated({ type: 'session.updated', session: session({ totalTokens: 10 }) }, ctx);
    expect(stopping()).toBe(true);

    handleSessionUpdated({ type: 'session.updated', session: session({ runningAt: null }) }, ctx);
    expect(stopping()).toBe(false);
  });

  test('an interrupt that stopped nothing shows the server state again', () => {
    handleSessionInterrupted(interrupted(false), context([session()]));
    expect(stopping()).toBe(false);
  });

  test('a run that already ended clears on the interrupt confirmation', () => {
    handleSessionInterrupted(interrupted(true), context([session({ runningAt: null })]));
    expect(stopping()).toBe(false);
  });

  test('a failed interrupt shows the server state again', () => {
    handleError({ type: 'error', code: 'interrupt_error', message: 'Interrupt failed', sessionId: 's' }, context([]));
    expect(stopping()).toBe(false);
  });

  test('a new run starting after Stop shows as running', () => {
    const ctx = context([session({ runningAt: null })]);
    handleSessionUpdated({ type: 'session.updated', session: session() }, ctx);
    expect(stopping()).toBe(false);
  });

  test('a queued prompt starting its reply shows as running, even in an unloaded session', () => {
    handleMessageCreated({ type: 'message.created', message: {
      id: 'm', sessionId: 's', role: 'assistant', status: 'streaming', createdAt: 1,
    } as unknown as Message }, context([session()]));
    expect(stopping()).toBe(false);
  });
});
