import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import { useWorkspaceSessions } from './useWorkspaceSessions';

type FoldedSection = 'archived' | 'scheduled' | 'conversations';
const CLOSED: Record<FoldedSection, boolean> = { archived: false, scheduled: false, conversations: false };

/**
 * The folded sidebar sections (archived, scheduled, conversations other
 * agents started here): counts load with the workspace, the sessions only
 * once a section is opened.
 */
export function useSessionCategories(sdkClient: ProkopaiClient | null, workspaceId: string | null, connected: boolean) {
  const [expanded, setExpanded] = useState({ workspaceId, ...CLOSED });
  // Reset during render so a workspace change cannot fetch a previously expanded category.
  if (expanded.workspaceId !== workspaceId) {
    setExpanded({ workspaceId, ...CLOSED });
  }
  const isOpen = (key: FoldedSection) => expanded.workspaceId === workspaceId && expanded[key];
  const archivedOpen = isOpen('archived');
  const scheduledOpen = isOpen('scheduled');
  const conversationsOpen = isOpen('conversations');
  const counts = useQuery({
    queryKey: queryKeys.sessions.counts(workspaceId ?? ''),
    queryFn: ({ signal }) => sdkClient!.http.sessions.countsByWorkspace(workspaceId!, { signal }),
    enabled: !!sdkClient && !!workspaceId && connected,
    staleTime: 10_000,
  });
  const archived = useWorkspaceSessions({ sdkClient, workspaceId, connected, category: 'archived', enabled: archivedOpen });
  const scheduled = useWorkspaceSessions({ sdkClient, workspaceId, connected, category: 'scheduled', enabled: scheduledOpen });
  const conversations = useWorkspaceSessions({ sdkClient, workspaceId, connected, category: 'conversations', enabled: conversationsOpen });
  return {
    counts: counts.data?.counts,
    countsError: counts.error?.message,
    retryCounts: () => { void counts.refetch(); },
    archived: { ...archived, open: archivedOpen, onOpenChange: (open: boolean) => setExpanded(s => ({ ...s, archived: open })) },
    scheduled: { ...scheduled, open: scheduledOpen, onOpenChange: (open: boolean) => setExpanded(s => ({ ...s, scheduled: open })) },
    conversations: { ...conversations, open: conversationsOpen, onOpenChange: (open: boolean) => setExpanded(s => ({ ...s, conversations: open })) },
  };
}

export type SessionCategories = ReturnType<typeof useSessionCategories>;
