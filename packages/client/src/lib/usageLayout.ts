/**
 * Which usage groups the dock's Usage panel shows and in what order. A
 * client-side preference: this device only, in localStorage. Groups the
 * preference does not know (a new provider, a new Codex account) go last
 * and visible, so nothing new is ever hidden by an old preference.
 */

export const USAGE_LAYOUT_KEY = 'prokopai_usage_layout';

export interface UsageLayout {
  /** Group ids in display order; ids not listed follow in their natural order. */
  order: string[];
  /** Group ids kept out of the panel. */
  hidden: string[];
}

export const EMPTY_USAGE_LAYOUT: UsageLayout = { order: [], hidden: [] };

const ids = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0 && entry.length <= 200)
  : [];

export function loadUsageLayout(): UsageLayout {
  try {
    const raw = localStorage.getItem(USAGE_LAYOUT_KEY);
    if (!raw) return EMPTY_USAGE_LAYOUT;
    const parsed = JSON.parse(raw) as { order?: unknown; hidden?: unknown };
    return { order: ids(parsed.order), hidden: ids(parsed.hidden) };
  } catch {
    return EMPTY_USAGE_LAYOUT;
  }
}

export function saveUsageLayout(layout: UsageLayout): void {
  try {
    if (layout.order.length === 0 && layout.hidden.length === 0) localStorage.removeItem(USAGE_LAYOUT_KEY);
    else localStorage.setItem(USAGE_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // A full or blocked store keeps the in-memory layout for this visit.
  }
}

/** Splits the groups into the ones shown, in preference order, and the hidden ones in their natural order. */
export function arrangeUsageEntries<T extends { id: string }>(entries: T[], layout: UsageLayout): { visible: T[]; hidden: T[] } {
  const rank = new Map(layout.order.map((id, index) => [id, index]));
  const hiddenIds = new Set(layout.hidden);
  const visible = entries.filter(entry => !hiddenIds.has(entry.id));
  const known = visible.filter(entry => rank.has(entry.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const unknown = visible.filter(entry => !rank.has(entry.id));
  return { visible: [...known, ...unknown], hidden: entries.filter(entry => hiddenIds.has(entry.id)) };
}

/**
 * Moves one shown group a step up or down. `visibleIds` is the order on
 * screen, so the saved order lists every shown group even when the
 * preference knew only some of them before.
 */
export function moveUsageEntry(layout: UsageLayout, visibleIds: string[], id: string, direction: 'up' | 'down'): UsageLayout {
  const index = visibleIds.indexOf(id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= visibleIds.length) return layout;
  const order = [...visibleIds];
  order[index] = visibleIds[target]!;
  order[target] = id;
  return { ...layout, order };
}

export function hideUsageEntry(layout: UsageLayout, id: string): UsageLayout {
  return layout.hidden.includes(id) ? layout : { ...layout, hidden: [...layout.hidden, id] };
}

export function showUsageEntry(layout: UsageLayout, id: string): UsageLayout {
  return { ...layout, hidden: layout.hidden.filter(entry => entry !== id) };
}
