import { create } from 'zustand';
import { useServerDataStore } from './serverDataStore';
import { useSessionBoardStore } from './sessionBoardStore';
import type { RepositoryViewId } from './workspaceViewStore';

/**
 * Per-session Files preferences: which repository view the phone Files
 * surface shows, and which checkout root the Explorer, Changes and Branches
 * views read. Keyed by server, workspace and focused session. Not persisted.
 * Where views are placed and which are visible belongs to workspaceViewStore.
 */
export type FilesPanelTab = RepositoryViewId;

interface SessionFilesLayout {
  filesPanelTab: FilesPanelTab;
  filesPanelRoot: string | null;
  filesPanelRootPinned: boolean;
}
const defaultSessionFilesLayout: SessionFilesLayout = {
  filesPanelTab: 'explorer', filesPanelRoot: null, filesPanelRootPinned: false,
};
function scopeKey(serverId: string | null, workspaceId: string | undefined, sessionId: string | null): string | null {
  return serverId && workspaceId && sessionId ? JSON.stringify([serverId, workspaceId, sessionId]) : null;
}
function updateSessionLayout(state: SessionFilesState, patch: Partial<SessionFilesLayout>): Partial<SessionFilesState> {
  const server = useServerDataStore.getState();
  const key = scopeKey(server.serverId, server.activeWorkspaceId ?? undefined, useSessionBoardStore.getState().focusedSessionId);
  return key ? { sessionFilesLayouts: { ...state.sessionFilesLayouts, [key]: { ...(state.sessionFilesLayouts[key] ?? defaultSessionFilesLayout), ...patch } } } : patch;
}

interface SessionFilesState extends SessionFilesLayout {
  sessionFilesLayouts: Record<string, SessionFilesLayout>;
}

interface SessionFilesActions {
  setFilesPanelTab: (tab: FilesPanelTab) => void;
  setFilesPanelRoot: (root: string | null) => void;
  setFilesPanelRootPinned: (pinned: boolean) => void;
}

type SessionFilesStore = SessionFilesState & SessionFilesActions;

export const useSessionFilesStore = create<SessionFilesStore>((set) => ({
  sessionFilesLayouts: {},
  ...defaultSessionFilesLayout,

  setFilesPanelTab: (tab) => set((state) => updateSessionLayout(state, { filesPanelTab: tab })),
  setFilesPanelRoot: (root) => set((state) => updateSessionLayout(state, { filesPanelRoot: root })),
  setFilesPanelRootPinned: (filesPanelRootPinned) => set((state) => updateSessionLayout(state, { filesPanelRootPinned })),
}));

/** Select the focused session's Files preferences without copying state on focus changes. */
export function useScopedSessionFiles<T>(selector: (state: SessionFilesStore) => T): T {
  const serverId = useServerDataStore((state) => state.serverId);
  const workspaceId = useServerDataStore((state) => state.activeWorkspaceId ?? undefined);
  const sessionId = useSessionBoardStore((state) => state.focusedSessionId);
  const key = scopeKey(serverId, workspaceId, sessionId);
  return useSessionFilesStore((state) => selector(key
    ? { ...state, ...(state.sessionFilesLayouts[key] ?? defaultSessionFilesLayout) }
    : state));
}
