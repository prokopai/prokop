import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import type { AgentGroup, AgentGroupMessage, CreateGroupInput, ListGroupMessagesResponse, ProkopaiClient, UpdateGroupInput } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Group chats of a workspace and one group's thread. Lists and groups update
 * from `group.updated` and `group.deleted`; the thread grows from
 * `group.message.created` (handlers/serverMessage/groupHandlers.ts). No
 * polling.
 */

export const GROUP_MESSAGES_PAGE = 50;

export function useGroupsQuery(sdkClient: ProkopaiClient | null, workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.groups.byWorkspace(workspaceId ?? ''),
    queryFn: async ({ signal }) => (await sdkClient!.http.groups.list(workspaceId!, { signal })).groups,
    enabled: !!sdkClient && !!workspaceId,
  });
}

export function useGroupQuery(sdkClient: ProkopaiClient | null, groupId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.groups.one(groupId ?? ''),
    queryFn: async ({ signal }) => (await sdkClient!.http.groups.get(groupId!, { signal })).group,
    enabled: !!sdkClient && !!groupId,
  });
}

/** Pages are loaded newest first; `fetchNextPage` loads the page before the oldest loaded one. */
export function useGroupMessagesQuery(sdkClient: ProkopaiClient | null, groupId: string | null | undefined) {
  return useInfiniteQuery<ListGroupMessagesResponse, Error, InfiniteData<ListGroupMessagesResponse, number | undefined>, readonly string[], number | undefined>({
    queryKey: queryKeys.groups.messages(groupId ?? ''),
    queryFn: async ({ pageParam, signal }) => sdkClient!.http.groups.listMessages(groupId!, {
      ...(pageParam !== undefined ? { before: pageParam } : {}), limit: GROUP_MESSAGES_PAGE,
    }, { signal }),
    initialPageParam: undefined,
    getNextPageParam: (page) => (page.hasMore && page.messages.length > 0 ? page.messages[0]!.seq : undefined),
    enabled: !!sdkClient && !!groupId,
  });
}

/** Every loaded message, oldest first, each once. */
export function flattenGroupMessages(data: InfiniteData<ListGroupMessagesResponse, number | undefined> | undefined): AgentGroupMessage[] {
  if (!data) return [];
  const byId = new Map<string, AgentGroupMessage>();
  for (const page of data.pages) for (const message of page.messages) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

/** Adds a message to a loaded thread; a thread not loaded yet fetches it on open. */
export function appendGroupMessage(queryClient: QueryClient, message: AgentGroupMessage): void {
  queryClient.setQueryData<InfiniteData<ListGroupMessagesResponse, number | undefined>>(queryKeys.groups.messages(message.groupId), (data) => {
    if (!data || data.pages.length === 0) return data;
    const [newest, ...older] = data.pages;
    if (newest!.messages.some((existing) => existing.id === message.id)) return data;
    // The server's copy of this client's own post (by event or response) replaces the local one.
    const settled = isLocalGroupMessage(message)
      ? newest!.messages
      : newest!.messages.filter((existing) => !(isLocalGroupMessage(existing) && message.authorKind === 'user' && groupMessageText(existing) === groupMessageText(message)));
    const messages = [...settled, message].sort((left, right) => left.seq - right.seq);
    return { ...data, pages: [{ ...newest!, messages }, ...older] };
  });
}

/** The client's own id for a post still on its way; the server's message replaces it. */
export const LOCAL_GROUP_MESSAGE_PREFIX = 'local:';

export function isLocalGroupMessage(message: AgentGroupMessage): boolean {
  return message.id.startsWith(LOCAL_GROUP_MESSAGE_PREFIX);
}

function groupMessageText(message: AgentGroupMessage): string {
  return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** Puts a group into its own query and its workspace list. */
export function putGroup(queryClient: QueryClient, group: AgentGroup): void {
  queryClient.setQueryData(queryKeys.groups.one(group.id), group);
  queryClient.setQueryData<AgentGroup[]>(queryKeys.groups.byWorkspace(group.workspaceId), (groups) => {
    if (!groups) return groups;
    const rest = groups.filter((existing) => existing.id !== group.id);
    return [...rest, group].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  });
}

export function dropGroup(queryClient: QueryClient, groupId: string, workspaceId: string): void {
  queryClient.setQueryData<AgentGroup[]>(queryKeys.groups.byWorkspace(workspaceId), (groups) => groups?.filter((group) => group.id !== groupId));
  queryClient.removeQueries({ queryKey: queryKeys.groups.one(groupId) });
  queryClient.removeQueries({ queryKey: queryKeys.groups.messages(groupId) });
}

export function useCreateGroup(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateGroupInput) => (await sdkClient!.http.groups.create(body)).group,
    onSuccess: (group) => putGroup(queryClient, group),
  });
}

export function useUpdateGroup(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, updates }: { groupId: string; updates: UpdateGroupInput }) => (await sdkClient!.http.groups.update(groupId, updates)).group,
    onSuccess: (group) => putGroup(queryClient, group),
  });
}

export function useDeleteGroup(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (group: Pick<AgentGroup, 'id' | 'workspaceId'>) => { await sdkClient!.http.groups.delete(group.id); return group; },
    onSuccess: (group) => dropGroup(queryClient, group.id, group.workspaceId),
  });
}

export function useAddGroupMember(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, agentId }: { groupId: string; agentId: string }) => (await sdkClient!.http.groups.addMember(groupId, agentId)).group,
    onSuccess: (group) => putGroup(queryClient, group),
  });
}

export function useRemoveGroupMember(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, agentId }: { groupId: string; agentId: string }) => (await sdkClient!.http.groups.removeMember(groupId, agentId)).group,
    onSuccess: (group) => putGroup(queryClient, group),
  });
}

/** Takes a message out of a loaded thread. */
export function removeGroupMessage(queryClient: QueryClient, groupId: string, messageId: string): void {
  queryClient.setQueryData<InfiniteData<ListGroupMessagesResponse, number | undefined>>(queryKeys.groups.messages(groupId), (data) => {
    if (!data) return data;
    return { ...data, pages: data.pages.map((page) => (page.messages.some((message) => message.id === messageId)
      ? { ...page, messages: page.messages.filter((message) => message.id !== messageId) }
      : page)) };
  });
}

/**
 * Posts to the group. The post shows in the thread at once under a local id,
 * as a session's optimistic send does; the server's copy (from the response
 * or the event, whichever lands first) takes its place, and a failed post is
 * taken out again.
 */
export function usePostGroupMessage(sdkClient: ProkopaiClient | null, groupId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { text: string; mentions?: string[] }) => sdkClient!.http.groups.post(groupId!, body),
    onMutate: (body) => {
      const id = `${LOCAL_GROUP_MESSAGE_PREFIX}${crypto.randomUUID()}`;
      // Sorted after everything the server has sent, until the server's copy takes over.
      appendGroupMessage(queryClient, {
        id, groupId: groupId!, seq: Number.MAX_SAFE_INTEGER, authorKind: 'user', authorAgentId: null, targetAgentId: null,
        sourceMessageId: null, hop: 0, createdAt: new Date().toISOString(),
        parts: [{ id: `${id}:text`, messageId: id, createdAt: Date.now(), type: 'text', text: body.text }],
      });
      return { localId: id };
    },
    onSuccess: (posted, _body, context) => {
      removeGroupMessage(queryClient, groupId!, context.localId);
      appendGroupMessage(queryClient, posted.message);
    },
    onError: (_error, _body, context) => {
      if (context) removeGroupMessage(queryClient, groupId!, context.localId);
    },
  });
}
