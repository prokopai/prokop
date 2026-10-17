import type { NavigateFunction } from './types';
import {
  useSessionBoardStore,
  serializeOpenSessionIds,
} from '@/stores/sessionBoardStore';

export interface BoardNavigateOptions {
  /** Replace URL state instead of adding history entry (for focus changes). */
  replace?: boolean;
}

/**
 * Build a navigation target for the board.
 * Returns the route `to`, `params`, and `search` for TanStack Router.
 */
function buildBoardNavTarget(
  viewPath: string,
  serverId: string,
  focusedSessionId: string | null,
  openSessionIds: string[],
): {
  to: string;
  params: Record<string, string>;
  search: { open?: string };
} {
  if (!focusedSessionId) {
    return {
      to: `/server/$serverId${viewPath}`,
      params: { serverId },
      search: {},
    };
  }

  const open = serializeOpenSessionIds(openSessionIds.length > 1 ? openSessionIds : []);
  return {
    to: `/server/$serverId${viewPath}/session/$sessionId`,
    params: { serverId, sessionId: focusedSessionId },
    search: open ? { open } : {},
  };
}

/**
 * Navigate the board to show a focused session.
 * Focus changes use replace; open/add/remove changes push history.
 */
export function navigateBoard(
  navigate: NavigateFunction,
  viewPath: string,
  serverId: string,
  options: BoardNavigateOptions = {},
): void {
  const state = useSessionBoardStore.getState();
  const target = buildBoardNavTarget(viewPath, serverId, state.focusedSessionId, state.openSessionIds);
  navigate({
    to: target.to,
    params: target.params,
    search: target.search,
    replace: options.replace,
  });
}
