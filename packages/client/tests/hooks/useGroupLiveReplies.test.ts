import { beforeEach, expect, test, vi } from 'vitest';
import type { Message, Part } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage/types';

vi.mock('@/components/providers/QueryProvider', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { ensureMemberSessionContent, liveReplyOf } from '@/hooks/useGroupMemberStatuses';
import { handleMessageCreated } from '@/handlers/serverMessage/messagePartHandlers';
import { useSessionContentStore } from '@/stores/sessionContentStore';

const assistant = (id: string, status: 'streaming' | 'completed'): Message =>
  ({ id, sessionId: 's', role: 'assistant', status, modelId: 'm', providerId: 'p', tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: 1 });
const user: Message = { id: 'u1', sessionId: 's', role: 'user', createdAt: 1 };
const text: Part = { id: 'p1', messageId: 'a1', createdAt: 1, type: 'text', text: 'On it' };

beforeEach(() => {
  useSessionContentStore.setState({ messagesBySession: {}, partsBySession: {} });
});

test('a member is writing while its last message streams; a finished or absent reply is nothing', () => {
  expect(liveReplyOf([user, assistant('a1', 'streaming')], { a1: [text] })).toEqual({ message: assistant('a1', 'streaming'), parts: [text] });
  expect(liveReplyOf([user, assistant('a1', 'streaming')], undefined)).toEqual({ message: assistant('a1', 'streaming'), parts: [] });
  expect(liveReplyOf([user, assistant('a1', 'completed')], { a1: [text] })).toBeNull();
  expect(liveReplyOf([assistant('a1', 'streaming'), user], { a1: [text] })).toBeNull();
  expect(liveReplyOf([], {})).toBeNull();
  expect(liveReplyOf(undefined, undefined)).toBeNull();
});

/** The handlers only keep messages for sessions with content in the store; a watched member session never loaded any. */
test('a watched member session keeps the reply it starts and reads as streaming, once its content entry exists', () => {
  const store = useSessionContentStore.getState();
  const ctx = {
    setMessagesBySession: store.setMessagesBySession,
    setPartsBySession: store.setPartsBySession,
    addStreamingSession: vi.fn(),
    removeInterruptedSession: vi.fn(),
    clearCompletion: vi.fn(),
  } as unknown as SessionHandlersContext;
  const started = { type: 'message.created' as const, message: assistant('a1', 'streaming') };

  handleMessageCreated(started, ctx);
  expect(useSessionContentStore.getState().messagesBySession.s).toBeUndefined();
  expect(ctx.addStreamingSession).not.toHaveBeenCalled();

  ensureMemberSessionContent(['s']);
  handleMessageCreated(started, ctx);
  expect(useSessionContentStore.getState().messagesBySession.s).toEqual([assistant('a1', 'streaming')]);
  expect(ctx.addStreamingSession).toHaveBeenCalledWith('s');

  // Content already there (a pane opened the session) is left alone.
  ensureMemberSessionContent(['s']);
  expect(useSessionContentStore.getState().messagesBySession.s).toHaveLength(1);
});
