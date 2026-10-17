import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import { toast } from 'sonner';
import type { ProkopaiClient, Session, Workspace, WorkspaceSettings } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { randomUUID } from '@/lib/randomId';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionContentStore } from '@/stores/sessionContentStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';

type Navigate = (opts: { to: string; params?: Record<string, string>; search?: Record<string, unknown> }) => void;

interface UseWorkspaceCommandsOptions {
  clientRef: RefObject<ProkopaiClient | null>;
  serverId: string;
  navigate: Navigate;
  /** The session shown in the URL, so deleting its workspace leaves it. */
  currentSession: Session | null;
  removeFromQuickConnectionsByWorkspace: (workspaceId: string) => void;
  /** Sessions that went away with a deleted workspace, for caches the caller owns. */
  onSessionsDeleted: (sessionIds: string[]) => void;
}

interface PatchMessages {
  success?: string;
  failure: string;
  /** Session lists show workspace names and paths. */
  refreshSessions?: boolean;
  refreshFiles?: boolean;
}

/** Create, select, change and delete workspaces, with their pending states. */
export function useWorkspaceCommands({
  clientRef,
  serverId,
  navigate,
  currentSession,
  removeFromQuickConnectionsByWorkspace,
  onSessionsDeleted,
}: UseWorkspaceCommandsOptions) {
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [isUpdatingWorkspace, setIsUpdatingWorkspace] = useState<Record<string, boolean>>({});

  const goToWorkspace = () => navigate({ to: '/server/$serverId/workspace', params: { serverId } });

  const createWorkspace = async (name: string, path: string, isVirtual: boolean) => {
    const http = clientRef.current?.httpClient;
    if (!http) return;

    const { workspace } = await http.post<{ workspace: Workspace }>('/workspaces', { name, path, isVirtual });
    const store = useServerDataStore.getState();
    store.setWorkspaces([...store.workspaces, workspace]);
    store.setActiveWorkspaceId(workspace.id);
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    goToWorkspace();
    return workspace;
  };

  const createWithFeedback = async (name: string, path: string, isVirtual: boolean) => {
    setIsCreatingWorkspace(true);
    try {
      await createWorkspace(name, path, isVirtual);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to create workspace', { description: message });
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleCreateVirtualWorkspace = () => createWithFeedback(
    `Workspace ${useServerDataStore.getState().workspaces.length + 1}`,
    `~/.prokopai/workspaces/${randomUUID()}`,
    true,
  );

  const handleCreatePhysicalWorkspace = (path: string) => createWithFeedback(
    path.split('/').pop() || path.split('\\').pop() || 'Workspace',
    path,
    false,
  );

  const selectWorkspace = useCallback((workspace: Workspace) => {
    useServerDataStore.getState().setActiveWorkspaceId(workspace.id);
    useSessionBoardStore.getState().clearBoard();
    navigate({ to: '/server/$serverId/workspace', params: { serverId } });
  }, [navigate, serverId]);

  const deleteWorkspace = async (id: string) => {
    const http = clientRef.current?.httpClient;
    if (!http) return;

    setDeletingWorkspaceId(id);
    let deletedSessions: string[];
    try {
      ({ deletedSessions } = await http.delete<{ deletedSessions: string[] }>(`/workspaces/${id}`));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to delete workspace:', message);
      toast.error('Failed to delete workspace', { description: message });
      setDeletingWorkspaceId(null);
      return;
    }

    removeFromQuickConnectionsByWorkspace(id);
    useOverviewGroupsStore.getState().removeWorkspaceFromAllGroups(serverId, id);

    if (currentSession && (currentSession.workspaceId === id || deletedSessions.includes(currentSession.id))) {
      goToWorkspace();
    }

    useSessionStore.getState().setSessions(prev => prev.filter(s => !deletedSessions.includes(s.id)));
    useSessionContentStore.getState().evictSessionContentBatch(deletedSessions);
    onSessionsDeleted(deletedSessions);

    const store = useServerDataStore.getState();
    const remaining = store.workspaces.filter(w => w.id !== id);
    store.setWorkspaces(remaining);
    if (store.activeWorkspaceId === id) store.setActiveWorkspaceId(remaining[0]?.id ?? null);

    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    setDeletingWorkspaceId(null);
  };

  /** One PATCH path for every workspace field: updates the list and reports the outcome. */
  const patchWorkspace = async (id: string, body: Record<string, unknown>, messages: PatchMessages) => {
    const http = clientRef.current?.httpClient;
    if (!http) return;

    setIsUpdatingWorkspace(prev => ({ ...prev, [id]: true }));
    try {
      const { workspace } = await http.patch<{ workspace: Workspace }>(`/workspaces/${id}`, body);
      const store = useServerDataStore.getState();
      store.setWorkspaces(store.workspaces.map(w => w.id === id ? workspace : w));
      if (messages.refreshSessions) queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      if (messages.refreshFiles) queryClient.invalidateQueries({ queryKey: ['files'] });
      if (messages.success) toast.success(messages.success);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${messages.failure}:`, message);
      toast.error(messages.failure, { description: message });
    } finally {
      setIsUpdatingWorkspace(prev => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  const renameWorkspace = (id: string, name: string) =>
    patchWorkspace(id, { name }, { failure: 'Failed to rename workspace', refreshSessions: true });

  const updateWorkspacePath = (id: string, path: string) =>
    patchWorkspace(id, { path }, {
      success: 'Workspace folder updated',
      failure: 'Failed to update workspace folder',
      refreshSessions: true,
      refreshFiles: true,
    });

  const updateWorkspacePaths = (id: string, additionalPaths: string[]) =>
    patchWorkspace(id, { additionalPaths }, { success: 'Workspace paths updated', failure: 'Failed to update workspace paths' });

  const updateWorkspaceSettings = (id: string, settings: WorkspaceSettings) =>
    patchWorkspace(id, { settings }, { success: 'Workspace settings saved', failure: 'Failed to update workspace settings' });

  return {
    selectWorkspace,
    renameWorkspace,
    updateWorkspacePath,
    updateWorkspacePaths,
    updateWorkspaceSettings,
    handleCreateVirtualWorkspace,
    handleCreatePhysicalWorkspace,
    deleteWorkspace,
    isCreatingWorkspace,
    deletingWorkspaceId,
    isUpdatingWorkspace,
  };
}
