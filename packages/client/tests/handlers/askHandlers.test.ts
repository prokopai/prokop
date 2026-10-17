import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Ask } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage/types';
import { askHandlers } from '@/handlers/serverMessage/askHandlers';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { markUserActivity, resetUserActivityForTests } from '@/lib/userActivity';

function makeCtx(): SessionHandlersContext {
  return {
    addPendingAskRequest: vi.fn(),
    runAskHandlers: vi.fn(() => undefined),
    sendAskResponse: vi.fn(),
    sessionsRef: { current: [{ id: 'sess-1', parentId: null }] },
    notifiedToolCallIdsRef: { current: new Set<string>() },
    permissionSoundEnabledRef: { current: true },
    playPermissionSound: vi.fn(),
    currentSessionIdRef: { current: 'sess-1' },
    acknowledgeNotification: vi.fn(),
  } as unknown as SessionHandlersContext;
}

const permissionAsk = { type: 'permission', title: 'Run command', description: 'ls' } as unknown as Ask;
const questionAsk = { type: 'question', title: 'Which one?', questions: [] } as unknown as Ask;

function request(ask: Ask, requestId?: string) {
  return { type: 'ask.request' as const, sessionId: 'sess-1', toolCallId: 'tool-1', toolName: 'shell', ask, requestId };
}

describe('ask.request attention', () => {
  beforeEach(() => {
    resetUserActivityForTests();
    useSessionBoardStore.setState({ openSessionIds: ['sess-1'], focusedSessionId: 'sess-1' });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('an approval shown to someone present plays the sound and cancels the push', () => {
    markUserActivity();
    const ctx = makeCtx();
    askHandlers['ask.request'](request(permissionAsk, 'req-1'), ctx);

    expect(ctx.addPendingAskRequest).toHaveBeenCalled();
    expect(ctx.playPermissionSound).toHaveBeenCalledTimes(1);
    expect(ctx.acknowledgeNotification).toHaveBeenCalledWith('permission:req-1', 'sess-1');
  });

  test('a question acknowledges its own event id', () => {
    markUserActivity();
    const ctx = makeCtx();
    askHandlers['ask.request'](request(questionAsk, 'req-2'), ctx);
    expect(ctx.acknowledgeNotification).toHaveBeenCalledWith('question:req-2', 'sess-1');
  });

  test('a focused but idle window keeps the push, and still plays the sound', () => {
    // No input for a while: the screen may be asleep behind a focused window.
    const ctx = makeCtx();
    askHandlers['ask.request'](request(permissionAsk, 'req-3'), ctx);
    expect(ctx.playPermissionSound).toHaveBeenCalledTimes(1);
    expect(ctx.acknowledgeNotification).not.toHaveBeenCalled();
  });

  test('an ask for a session not shown here, or without a request id, is not acknowledged', () => {
    markUserActivity();
    useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
    const elsewhere = makeCtx();
    elsewhere.currentSessionIdRef.current = null;
    askHandlers['ask.request'](request(permissionAsk, 'req-4'), elsewhere);
    expect(elsewhere.acknowledgeNotification).not.toHaveBeenCalled();

    useSessionBoardStore.setState({ openSessionIds: ['sess-1'], focusedSessionId: 'sess-1' });
    const legacy = makeCtx();
    askHandlers['ask.request'](request(permissionAsk), legacy);
    expect(legacy.acknowledgeNotification).not.toHaveBeenCalled();
  });
});
