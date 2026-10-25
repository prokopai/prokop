import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import type { AgentGroupMessage, ProkopaiClient } from '@prokopai/sdk';
import { appendGroupMessage, flattenGroupMessages, usePostGroupMessage, LOCAL_GROUP_MESSAGE_PREFIX } from '@/hooks/queries/useGroupQueries';
import { queryKeys } from '@/lib/queryKeys';

type Posted = { message: AgentGroupMessage; woken: string[] };

const serverMessage = (id: string, seq: number, text: string): AgentGroupMessage => ({
  id, groupId: 'g1', seq, authorKind: 'user', authorAgentId: null, targetAgentId: null, sourceMessageId: null, hop: 0,
  createdAt: '2026-10-24T00:00:00.000Z', parts: [{ id: `${id}-t`, messageId: id, createdAt: 1, type: 'text', text }],
});

function deferred() {
  let resolve!: (value: Posted) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Posted>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(post: () => Promise<Posted>) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  queryClient.setQueryData(queryKeys.groups.messages('g1'), { pages: [{ messages: [serverMessage('m1', 1, 'earlier')], hasMore: false }], pageParams: [undefined] });
  const client = { http: { groups: { post } } } as unknown as ProkopaiClient;
  const { result } = renderHook(() => usePostGroupMessage(client, 'g1'), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  const texts = () => flattenGroupMessages(queryClient.getQueryData(queryKeys.groups.messages('g1')))
    .map((message) => [message.id.startsWith(LOCAL_GROUP_MESSAGE_PREFIX) ? 'local' : message.id, (message.parts[0] as { text: string }).text]);
  return { result, queryClient, texts };
}

test('a post shows in the thread at once and the server copy takes its place when the response lands', async () => {
  const response = deferred();
  const { result, texts } = setup(() => response.promise);

  let pending!: Promise<unknown>;
  act(() => { pending = result.current.mutateAsync({ text: 'hello all' }); });
  expect(texts()).toEqual([['m1', 'earlier'], ['local', 'hello all']]);

  await act(async () => {
    response.resolve({ message: serverMessage('m2', 2, 'hello all'), woken: ['implementer'] });
    await pending;
  });
  expect(texts()).toEqual([['m1', 'earlier'], ['m2', 'hello all']]);
});

test('the event may land before the response: the server copy replaces the local one at once, and a failed post is taken out', async () => {
  const response = deferred();
  const { result, queryClient, texts } = setup(() => response.promise);
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.mutateAsync({ text: 'first' }); });
  // What the group.message.created handler does with the event.
  act(() => { appendGroupMessage(queryClient, serverMessage('m2', 2, 'first')); });
  expect(texts()).toEqual([['m1', 'earlier'], ['m2', 'first']]);
  await act(async () => {
    response.resolve({ message: serverMessage('m2', 2, 'first'), woken: [] });
    await pending;
  });
  expect(texts()).toEqual([['m1', 'earlier'], ['m2', 'first']]);

  const failing = setup(() => Promise.reject(new Error('The message is empty')));
  await act(async () => {
    await failing.result.current.mutateAsync({ text: 'oops' }).catch(() => undefined);
  });
  expect(failing.texts()).toEqual([['m1', 'earlier']]);
});
