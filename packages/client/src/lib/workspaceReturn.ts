import { useSessionBoardStore, serializeOpenSessionIds } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';

/**
 * Going from Overview (or another workspace) to a workspace keeps the tabs
 * that belong to it. The board's open sessions of that workspace travel in
 * the URL, the focused one staying in front when it is among them; the
 * route sync in workspace scope then opens exactly those.
 */

export interface WorkspaceReturnTarget {
  to: string;
  params: Record<string, string>;
  search: { open?: string };
}

/** The workspace a return from Overview lands in: the focused session's, else the active one. */
export function returnWorkspaceId(): string | null {
  const board = useSessionBoardStore.getState();
  const focused = board.focusedSessionId
    ? useSessionStore.getState().sessions.find((session) => session.id === board.focusedSessionId)
    : undefined;
  return focused?.workspaceId ?? useServerDataStore.getState().activeWorkspaceId ?? null;
}

/**
 * The other way: into Overview with the board's tabs when the server's active
 * group holds the active workspace, so a workspace that is part of the
 * overview keeps its sessions open there. Otherwise Overview opens plain.
 */
export function overviewReturnTarget(serverId: string): WorkspaceReturnTarget {
  const plain = { to: '/server/$serverId/overview', params: { serverId }, search: {} };
  const workspaceId = useServerDataStore.getState().activeWorkspaceId;
  const groups = useOverviewGroupsStore.getState().document;
  const activeGroupId = groups.activeGroupIdByServer[serverId];
  const group = activeGroupId ? groups.groups.find((candidate) => candidate.id === activeGroupId && candidate.serverId === serverId) : undefined;
  if (!workspaceId || !group || !group.workspaceIds.includes(workspaceId)) return plain;
  const board = useSessionBoardStore.getState();
  if (!board.focusedSessionId) return plain;
  const open = serializeOpenSessionIds(board.openSessionIds.length > 1 ? board.openSessionIds : []);
  return {
    to: '/server/$serverId/overview/session/$sessionId',
    params: { serverId, sessionId: board.focusedSessionId },
    search: open ? { open } : {},
  };
}

export function workspaceReturnTarget(serverId: string, workspaceId: string): WorkspaceReturnTarget {
  const board = useSessionBoardStore.getState();
  const owner = new Map(useSessionStore.getState().sessions.map((session) => [session.id, session.workspaceId]));
  const kept = board.openSessionIds.filter((id) => owner.get(id) === workspaceId);
  const focused = board.focusedSessionId && kept.includes(board.focusedSessionId) ? board.focusedSessionId : kept[0];
  if (!focused) return { to: '/server/$serverId/workspace', params: { serverId }, search: {} };
  const open = serializeOpenSessionIds(kept.length > 1 ? kept : []);
  return {
    to: '/server/$serverId/workspace/session/$sessionId',
    params: { serverId, sessionId: focused },
    search: open ? { open } : {},
  };
}
