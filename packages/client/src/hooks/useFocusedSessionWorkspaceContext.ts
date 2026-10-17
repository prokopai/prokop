import { useEffect } from 'react';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';

/**
 * Synchronize the focused session's workspace to the shared workspace context.
 *
 * In Overview, the shared workspace surfaces (files panel, terminal panel,
 * preconfigs, native actions) follow whichever session is focused.
 *
 * This hook:
 * 1. Reads `focusedSessionId` from `sessionBoardStore`.
 * 2. Resolves the session from `sessionStore.sessions`.
 * 3. Resolves its workspace from `serverDataStore.workspaces`.
 * 4. If it differs from `activeWorkspaceId`, calls `setActiveWorkspaceId`,
 *    which also remembers it across reloads.
 *
 * It does NOT:
 * - Clear the board.
 * - Navigate to /workspace.
 * - Resume or reload the focused session.
 *
 * If no session is focused, keeps the last workspace context.
 */
export function useFocusedSessionWorkspaceContext(): void {
  const focusedSessionId = useSessionBoardStore(s => s.focusedSessionId);
  const sessions = useSessionStore(s => s.sessions);
  const workspaces = useServerDataStore(s => s.workspaces);

  useEffect(() => {
    if (!focusedSessionId) return;

    const session = sessions.find(s => s.id === focusedSessionId);
    if (!session?.workspaceId) return;

    const targetWorkspace = workspaces.find(w => w.id === session.workspaceId);
    if (!targetWorkspace) return;

    const store = useServerDataStore.getState();
    if (store.activeWorkspaceId !== targetWorkspace.id) {
      store.setActiveWorkspaceId(targetWorkspace.id);
    }
  }, [focusedSessionId, sessions, workspaces]);
}
