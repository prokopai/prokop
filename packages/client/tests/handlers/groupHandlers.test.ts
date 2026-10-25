import type { InfiniteData } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';
import type { AgentGroup, AgentGroupMessage, ListGroupMessagesResponse } from '@prokopai/sdk';

vi.mock('@/components/providers/QueryProvider', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return { queryClient: new QueryClient() };
});

import { queryClient as client } from '@/components/providers/QueryProvider';
import { handleGroupDeleted, handleGroupMessageCreated, handleGroupUpdated } from '@/handlers/serverMessage/groupHandlers';
import { flattenGroupMessages } from '@/hooks/queries/useGroupQueries';
import { queryKeys } from '@/lib/queryKeys';
import { createDefaultViewLayout, groupViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';

const group = (overrides: Partial<AgentGroup> = {}): AgentGroup => ({
  id: 'g1', workspaceId: 'ws1', name: 'API work', defaultAgentId: 'implementer', permissionMode: 'standard', members: [], createdAt: '2026-10-23T00:00:01.000Z', updatedAt: '', ...overrides,
});
const message = (seq: number, overrides: Partial<AgentGroupMessage> = {}): AgentGroupMessage => ({
  id: `m${seq}`, groupId: 'g1', seq, authorKind: 'user', authorAgentId: null, targetAgentId: null, sourceMessageId: null,
  parts: [{ id: `p${seq}`, messageId: `m${seq}`, createdAt: 1, type: 'text', text: `message ${seq}` }], hop: 0, createdAt: '', ...overrides,
});
const thread = () => client.getQueryData<InfiniteData<ListGroupMessagesResponse, number | undefined>>(queryKeys.groups.messages('g1'));

beforeEach(() => {
  client.clear();
  useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
});

test('a group update replaces the group in its own query and in the workspace list, keeping creation order', () => {
  client.setQueryData(queryKeys.groups.byWorkspace('ws1'), [group(), group({ id: 'g2', name: 'Docs', createdAt: '2026-10-23T00:00:02.000Z' })]);
  handleGroupUpdated(group({ name: 'API work v2' }));
  expect(client.getQueryData<AgentGroup>(queryKeys.groups.one('g1'))?.name).toBe('API work v2');
  expect(client.getQueryData<AgentGroup[]>(queryKeys.groups.byWorkspace('ws1'))?.map((item) => item.name)).toEqual(['API work v2', 'Docs']);
  // A workspace list never loaded stays unloaded: it fetches on first open.
  handleGroupUpdated(group({ id: 'g3', workspaceId: 'ws2' }));
  expect(client.getQueryData(queryKeys.groups.byWorkspace('ws2'))).toBeUndefined();
});

test('a new message lands at the end of a loaded thread once; an unloaded thread is left for the fetch', () => {
  handleGroupMessageCreated(message(1));
  expect(thread()).toBeUndefined();
  client.setQueryData(queryKeys.groups.messages('g1'), { pages: [{ messages: [message(1), message(2)], hasMore: false }], pageParams: [undefined] });
  handleGroupMessageCreated(message(3));
  handleGroupMessageCreated(message(3));
  expect(flattenGroupMessages(thread()).map((item) => item.seq)).toEqual([1, 2, 3]);
  // Older pages loaded later sit after the newest page; flattening orders by seq and drops duplicates.
  client.setQueryData(queryKeys.groups.messages('g1'), (data: InfiniteData<ListGroupMessagesResponse, number | undefined>) => ({
    pages: [...data.pages, { messages: [message(0, { id: 'm0' }), message(1)], hasMore: false }], pageParams: [undefined, 1],
  }));
  expect(flattenGroupMessages(thread()).map((item) => item.seq)).toEqual([0, 1, 2, 3]);
});

test('a deleted group leaves the list and the caches, and its open tab closes', () => {
  client.setQueryData(queryKeys.groups.byWorkspace('ws1'), [group(), group({ id: 'g2' })]);
  client.setQueryData(queryKeys.groups.one('g1'), group());
  client.setQueryData(queryKeys.groups.messages('g1'), { pages: [{ messages: [message(1)], hasMore: false }], pageParams: [undefined] });
  const viewId = groupViewId('server-1', 'g1');
  useWorkspaceViewStore.getState().openInCenter(viewId);
  expect(Object.values(useWorkspaceViewStore.getState().layout.groups).some((entry) => entry.viewIds.includes(viewId))).toBe(true);

  handleGroupDeleted('g1', 'ws1');
  expect(client.getQueryData<AgentGroup[]>(queryKeys.groups.byWorkspace('ws1'))?.map((item) => item.id)).toEqual(['g2']);
  expect(client.getQueryData(queryKeys.groups.one('g1'))).toBeUndefined();
  expect(thread()).toBeUndefined();
  expect(Object.values(useWorkspaceViewStore.getState().layout.groups).some((entry) => entry.viewIds.includes(viewId))).toBe(false);
});
