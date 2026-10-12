import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Terminal tab order per workspace, on this device. The server lists
 * terminals in creation order; this records where you dragged them. Tabs not
 * in the record (new terminals) follow in server order.
 */
interface TerminalTabOrderState {
  byWorkspace: Record<string, string[]>;
  /** Moves `id` before `beforeId` (or to the end) within the shown order. */
  moveTab: (workspaceId: string, shown: readonly string[], id: string, beforeId: string | null) => void;
}

export const useTerminalTabOrderStore = create<TerminalTabOrderState>()(
  persist(
    (set) => ({
      byWorkspace: {},
      moveTab: (workspaceId, shown, id, beforeId) => {
        if (id === beforeId || !shown.includes(id)) return;
        // Saving only the shown ids also drops terminals that no longer exist.
        const rest = shown.filter((candidate) => candidate !== id);
        const index = beforeId === null ? rest.length : rest.indexOf(beforeId);
        rest.splice(index < 0 ? rest.length : index, 0, id);
        set((state) => ({ byWorkspace: { ...state.byWorkspace, [workspaceId]: rest } }));
      },
    }),
    { name: 'prokopai-terminal-tab-order' },
  ),
);

/** `tabs` in the recorded order; unrecorded tabs keep their relative order at the end. */
export function orderTerminalTabs<T extends { serverSessionId: string }>(tabs: T[], order: readonly string[] | undefined): T[] {
  if (!order?.length) return tabs;
  const rank = new Map(order.map((id, index) => [id, index]));
  return tabs
    .map((tab, index) => ({ tab, index, rank: rank.get(tab.serverSessionId) ?? Infinity }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ tab }) => tab);
}
