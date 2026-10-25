import type { AgentGroup, AgentGroupMessage } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { appendGroupMessage, dropGroup, putGroup } from '@/hooks/queries/useGroupQueries';
import { isGroupViewId, parseGroupViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';

/**
 * Group chat events from the server, for every client: a group changed
 * (name, members, default), a group went away, a message landed in a thread.
 * They update the query caches in place, so nothing polls.
 */

export function handleGroupUpdated(group: AgentGroup): void {
  if (!group || typeof group.id !== 'string') return;
  putGroup(queryClient, group);
}

export function handleGroupDeleted(groupId: string, workspaceId: string): void {
  if (typeof groupId !== 'string' || typeof workspaceId !== 'string') return;
  dropGroup(queryClient, groupId, workspaceId);
  // A tab showing the deleted group closes on every machine's layout entry for it.
  const store = useWorkspaceViewStore.getState();
  for (const viewId of Object.values(store.layout.groups).flatMap((group) => group.viewIds)) {
    if (isGroupViewId(viewId) && parseGroupViewId(viewId)?.groupId === groupId) store.removeView(viewId);
  }
}

export function handleGroupMessageCreated(message: AgentGroupMessage): void {
  if (!message || typeof message.groupId !== 'string') return;
  appendGroupMessage(queryClient, message);
}
