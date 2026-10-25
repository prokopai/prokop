import { create } from 'zustand';
import { useDockStore } from '@/stores/dockStore';
import type { DockPosition, DockState } from '@/stores/dockStore';
import { useSessionFilesStore } from '@/stores/sessionFilesStore';
import { filterTree, mapTree, treeGroups, type SplitDirection, type ViewTree } from '@/stores/workspaceSplitLayout';
import { randomUUID } from '@/lib/randomId';
import { isMobileViewport } from '@/lib/viewport';

const LEGACY_VIEW_IDS = ['sessions', 'conversations', 'files', 'editor', 'terminals'] as const;
export const REPOSITORY_VIEW_IDS = ['explorer', 'changes', 'branches', 'worktrees'] as const;
export type RepositoryViewId = typeof REPOSITORY_VIEW_IDS[number];
const ORIGINAL_VIEW_IDS = ['sessions', 'conversations', ...REPOSITORY_VIEW_IDS, 'editor', 'terminals'] as const;
export const WORKSPACE_VIEW_IDS = [...ORIGINAL_VIEW_IDS, 'usage'] as const;
export type WorkspaceToolViewId = typeof WORKSPACE_VIEW_IDS[number];
export type FileViewId = `file:${string}`;
export type SessionViewId = `session:${string}:${string}`;
/** Pull requests of one workspace; several can be open side by side, like files. */
export type PullRequestsViewId = `prs:${string}:${string}`;
/** The settings of one server: a tab in the center, a surface on the phone. */
export type SettingsViewId = `settings:${string}`;
/** One group chat; several can be open side by side, like sessions. */
export type GroupViewId = `group:${string}:${string}`;
export type ResourceViewId = FileViewId | SessionViewId | PullRequestsViewId | SettingsViewId | GroupViewId;
export type WorkspaceViewId = WorkspaceToolViewId | ResourceViewId;

/** The single pull requests tab of earlier layouts; dropped when a layout loads. */
const LEGACY_PULL_REQUESTS_VIEW = 'pull-requests';

export function pullRequestsViewId(serverId: string, workspaceId: string): PullRequestsViewId {
  return `prs:${encodeURIComponent(serverId)}:${encodeURIComponent(workspaceId)}`;
}

export function parsePullRequestsViewId(id: string): { serverId: string; workspaceId: string } | null {
  if (!id.startsWith('prs:')) return null;
  const parts = id.slice(4).split(':');
  try {
    if (parts.length !== 2 || !parts.every((part) => !!part && encodeURIComponent(decodeURIComponent(part)) === part)) return null;
    return { serverId: decodeURIComponent(parts[0]), workspaceId: decodeURIComponent(parts[1]) };
  } catch { return null; }
}

export function isPullRequestsViewId(id: string): id is PullRequestsViewId {
  return parsePullRequestsViewId(id) !== null;
}

export function groupViewId(serverId: string, groupId: string): GroupViewId {
  return `group:${encodeURIComponent(serverId)}:${encodeURIComponent(groupId)}`;
}

export function parseGroupViewId(id: string): { serverId: string; groupId: string } | null {
  if (!id.startsWith('group:')) return null;
  const parts = id.slice('group:'.length).split(':');
  try {
    if (parts.length !== 2 || !parts.every((part) => !!part && encodeURIComponent(decodeURIComponent(part)) === part)) return null;
    return { serverId: decodeURIComponent(parts[0]), groupId: decodeURIComponent(parts[1]) };
  } catch { return null; }
}

export function isGroupViewId(id: string): id is GroupViewId {
  return parseGroupViewId(id) !== null;
}

export function settingsViewId(serverId: string): SettingsViewId {
  return `settings:${encodeURIComponent(serverId)}`;
}

export function parseSettingsViewId(id: string): { serverId: string } | null {
  if (!id.startsWith('settings:')) return null;
  const part = id.slice('settings:'.length);
  try {
    return part && encodeURIComponent(decodeURIComponent(part)) === part ? { serverId: decodeURIComponent(part) } : null;
  } catch { return null; }
}

export function isSettingsViewId(id: string): id is SettingsViewId {
  return parseSettingsViewId(id) !== null;
}

export function sessionViewId(serverId: string, sessionId: string): SessionViewId {
  return `session:${encodeURIComponent(serverId)}:${encodeURIComponent(sessionId)}`;
}

export function isSessionViewId(id: string): id is SessionViewId {
  if (!id.startsWith('session:')) return false;
  const parts = id.slice(8).split(':');
  try {
    return parts.length === 2 && parts.every((part) => !!part && encodeURIComponent(decodeURIComponent(part)) === part);
  } catch { return false; }
}

function isResourceViewId(id: string): id is ResourceViewId {
  return isFileViewId(id) || isSessionViewId(id) || isPullRequestsViewId(id) || isSettingsViewId(id) || isGroupViewId(id);
}

export function fileViewId(docId: string): FileViewId {
  return `file:${encodeURIComponent(docId)}`;
}

export function isFileViewId(id: string): id is FileViewId {
  if (!id.startsWith('file:')) return false;
  try {
    const encoded = id.slice(5);
    const decoded = decodeURIComponent(encoded);
    const parts = decoded.split('\u0001');
    return encodeURIComponent(decoded) === encoded && parts.length === 4
      && !!parts[0] && !!parts[1] && !!parts[3];
  } catch { return false; }
}
export const VIEW_REGIONS = ['left', 'center', 'right', 'bottom'] as const;
export type ViewRegion = DockPosition | 'center';

export interface ViewGroup {
  viewIds: WorkspaceViewId[];
  activeId: WorkspaceViewId | null;
}

export interface WorkspaceViewLayout {
  groups: Record<string, ViewGroup>;
  roots: Record<ViewRegion, ViewTree>;
  hidden: WorkspaceViewId[];
}

export const VIEW_LAYOUT_STORAGE_KEY = 'prokopai_workspace_views';

export function createDefaultViewLayout(): WorkspaceViewLayout {
  return {
    roots: { left: { kind: 'group', groupId: 'left' }, center: { kind: 'group', groupId: 'center' }, right: { kind: 'group', groupId: 'right' }, bottom: { kind: 'group', groupId: 'bottom' } },
    groups: {
      left: { viewIds: ['sessions', 'usage'], activeId: 'sessions' },
      center: { viewIds: ['conversations', 'editor'], activeId: 'conversations' },
      right: { viewIds: [...REPOSITORY_VIEW_IDS], activeId: 'explorer' },
      bottom: { viewIds: ['terminals'], activeId: 'terminals' },
    },
    hidden: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWorkspaceViewId(value: unknown): value is WorkspaceViewId {
  return WORKSPACE_VIEW_IDS.some((id) => id === value) || (typeof value === 'string' && isResourceViewId(value));
}

/** Removes the legacy single pull requests tab from a stored layout before it is validated. */
function dropLegacyPullRequests(value: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(value.groups) || !Array.isArray(value.hidden)) return value;
  const groups: Record<string, unknown> = {};
  for (const [key, group] of Object.entries(value.groups)) {
    if (!isRecord(group) || !Array.isArray(group.viewIds)) { groups[key] = group; continue; }
    const viewIds = group.viewIds.filter((id) => id !== LEGACY_PULL_REQUESTS_VIEW);
    groups[key] = { ...group, viewIds, activeId: group.activeId === LEGACY_PULL_REQUESTS_VIEW ? viewIds[0] ?? null : group.activeId };
  }
  return { ...value, groups, hidden: value.hidden.filter((id) => id !== LEGACY_PULL_REQUESTS_VIEW) };
}

export function parseViewLayout(stored: unknown): WorkspaceViewLayout | null {
  const value = isRecord(stored) ? dropLegacyPullRequests(stored) : stored;
  if (isRecord(value) && value.version === 5) return addUsageView(parseSplitLayout(value));
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4) || !isRecord(value.groups)
    || !Array.isArray(value.hidden)) return null;
  const legacy = value.version === 1 || value.version === 2;
  const requiredIds = legacy ? LEGACY_VIEW_IDS : ORIGINAL_VIEW_IDS;
  const validId = (id: unknown): id is string => typeof id === 'string'
    && (requiredIds.some((required) => required === id) || (!legacy && id === 'usage') || (value.version !== 1 && isFileViewId(id)) || (value.version === 4 && isSessionViewId(id)));
  if (!value.hidden.every(validId)) return null;
  const expand = (id: string): WorkspaceViewId[] => legacy && id === 'files'
    ? [...REPOSITORY_VIEW_IDS] : [id as WorkspaceViewId];
  const groups = {} as Record<ViewRegion, ViewGroup>;
  const seen = new Set<string>();
  for (const region of VIEW_REGIONS) {
    const group = value.groups[region];
    if (!isRecord(group) || !Array.isArray(group.viewIds) || !group.viewIds.every(validId)) return null;
    if (group.activeId !== null && (!validId(group.activeId) || !group.viewIds.includes(group.activeId))) return null;
    for (const id of group.viewIds) {
      if (seen.has(id)) return null;
      seen.add(id);
    }
    groups[region] = {
      viewIds: group.viewIds.flatMap(expand),
      activeId: group.activeId === null ? null : expand(group.activeId as string)[0],
    };
  }
  if (!requiredIds.every((id) => seen.has(id)) || value.hidden.some((id) => !seen.has(id))) return null;
  return addUsageView({ groups, roots: createDefaultViewLayout().roots, hidden: [...new Set(value.hidden.flatMap(expand))] });
}

/** Older layouts gain Usage without changing their splits, selections, or hidden views. */
function addUsageView(layout: WorkspaceViewLayout | null): WorkspaceViewLayout | null {
  if (!layout) return null;
  if (!Object.values(layout.groups).some(group => group.viewIds.includes('usage'))) {
    layout.groups[treeGroups(layout.roots.left)[0]].viewIds.push('usage');
  }
  return layout;
}

export function isViewOpen(layout: WorkspaceViewLayout, id: WorkspaceViewId): boolean {
  return Object.values(layout.groups).some((group) => group.viewIds.includes(id));
}

function parseSplitLayout(value: Record<string, unknown>): WorkspaceViewLayout | null {
  if (!isRecord(value.groups) || !isRecord(value.roots) || !Array.isArray(value.hidden)) return null;
  const groups: Record<string, ViewGroup> = {};
  const seen = new Set<WorkspaceViewId>();
  const entries = Object.entries(value.groups);
  if (entries.length < 4 || entries.length > 64) return null;
  for (const [id, group] of entries) {
    if (!/^(left|right|center|bottom|group-[\w-]+)$/.test(id) || !isRecord(group)
      || !Array.isArray(group.viewIds) || !group.viewIds.every(isWorkspaceViewId)
      || (group.activeId !== null && (!isWorkspaceViewId(group.activeId) || !group.viewIds.includes(group.activeId)))) return null;
    for (const view of group.viewIds) { if (seen.has(view)) return null; seen.add(view); }
    groups[id] = { viewIds: [...group.viewIds], activeId: group.activeId as WorkspaceViewId | null };
  }
  if (!ORIGINAL_VIEW_IDS.every((id) => seen.has(id)) || !value.hidden.every((id) => isWorkspaceViewId(id) && seen.has(id))) return null;
  const leaves = new Set<string>();
  const splits = new Set<string>();
  const parseTree = (node: unknown, region: ViewRegion, depth: number): ViewTree | null => {
    if (depth > 12 || !isRecord(node)) return null;
    if (node.kind === 'group') {
      if (typeof node.groupId !== 'string' || !Object.hasOwn(groups, node.groupId) || leaves.has(node.groupId)) return null;
      leaves.add(node.groupId);
      return { kind: 'group', groupId: node.groupId };
    }
    if (node.kind !== 'split' || typeof node.id !== 'string' || !/^split-[\w-]+$/.test(node.id) || splits.has(node.id)
      || (node.direction !== 'right' && node.direction !== 'down') || (region !== 'center' && node.direction !== (region === 'bottom' ? 'right' : 'down'))
      || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio) || node.ratio < 0.1 || node.ratio > 0.9) return null;
    splits.add(node.id);
    const first = parseTree(node.first, region, depth + 1);
    const second = parseTree(node.second, region, depth + 1);
    return first && second ? { kind: 'split', id: node.id, direction: node.direction, ratio: node.ratio, first, second } : null;
  };
  const roots = {} as Record<ViewRegion, ViewTree>;
  for (const region of VIEW_REGIONS) {
    const root = parseTree(value.roots[region], region, 0);
    if (!root) return null;
    roots[region] = root;
  }
  return leaves.size === entries.length ? { groups, roots, hidden: [...new Set(value.hidden as WorkspaceViewId[])] } : null;
}

function loadLayout(): WorkspaceViewLayout {
  try {
    if (typeof window !== 'undefined') {
      return parseViewLayout(JSON.parse(localStorage.getItem(VIEW_LAYOUT_STORAGE_KEY) ?? 'null')) ?? createDefaultViewLayout();
    }
  } catch { /* Unavailable or stale storage uses the default arrangement. */ }
  return createDefaultViewLayout();
}

function saveLayout(layout: WorkspaceViewLayout): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(VIEW_LAYOUT_STORAGE_KEY, JSON.stringify({ version: 5, ...layout }));
  } catch { /* Moving views still works without storage. */ }
}

export function findViewRegion(layout: WorkspaceViewLayout, id: WorkspaceViewId): ViewRegion {
  return groupRegion(layout, findViewGroup(layout, id));
}

function groupRegion(layout: WorkspaceViewLayout, groupId: string): ViewRegion {
  return VIEW_REGIONS.find((region) => treeGroups(layout.roots[region]).includes(groupId)) ?? 'center';
}

export function findViewGroup(layout: WorkspaceViewLayout, id: WorkspaceViewId): string {
  return Object.keys(layout.groups).find((key) => layout.groups[key].viewIds.includes(id))
    ?? (isFileViewId(id) || isPullRequestsViewId(id) || isSettingsViewId(id) ? findViewGroup(layout, 'editor') : isSessionViewId(id) ? findViewGroup(layout, 'conversations') : treeGroups(layout.roots.center)[0]);
}

function pruneEmptyGroups(layout: WorkspaceViewLayout): WorkspaceViewLayout {
  const groups = { ...layout.groups };
  const roots = { ...layout.roots };
  for (const region of VIEW_REGIONS) {
    const ids = treeGroups(roots[region]);
    const retained = ids.filter((key) => groups[key].viewIds.some((id) => id !== 'conversations' && id !== 'editor' && !layout.hidden.includes(id)));
    if (!retained.length) retained.push(ids[0]);
    roots[region] = filterTree(roots[region], (id) => retained.includes(id))!;
    for (const key of ids.filter((id) => !retained.includes(id))) {
      const target = retained[0];
      groups[target] = { ...groups[target], viewIds: [...groups[target].viewIds, ...groups[key].viewIds] };
      delete groups[key];
    }
  }
  return { ...layout, groups, roots };
}

/** Derive missing resource placement without copying resource stores in effects. */
export function resolveViewLayout(layout: WorkspaceViewLayout, available: readonly WorkspaceViewId[]): WorkspaceViewLayout {
  let resolved = layout;
  for (const id of available) {
    if (Object.values(resolved.groups).some((group) => group.viewIds.includes(id))) continue;
    const region = findViewGroup(resolved, id);
    resolved = {
      ...resolved,
      groups: { ...resolved.groups, [region]: { ...resolved.groups[region], viewIds: [...resolved.groups[region].viewIds, id] } },
    };
  }
  return resolved;
}

export function activeGroupView(layout: WorkspaceViewLayout, region: string, available: readonly WorkspaceViewId[]): WorkspaceViewId | null {
  const group = layout.groups[region];
  const visible = group.viewIds.filter((id) => available.includes(id) && !layout.hidden.includes(id));
  return group.activeId && visible.includes(group.activeId) ? group.activeId : visible[0] ?? null;
}

/**
 * The phone shows one surface at a time instead of docks. The terminal is a
 * sheet over whichever surface is shown, so it has its own flag.
 */
export type MobileSurface = 'chat' | 'sessions' | 'files' | 'editor' | 'pull-requests' | 'settings';

export function isRepositoryViewId(id: string): id is RepositoryViewId {
  return REPOSITORY_VIEW_IDS.some((view) => view === id);
}

/** The phone surface that shows a view. */
function mobileSurfaceFor(id: WorkspaceViewId): MobileSurface | 'terminal' {
  if (id === 'terminals') return 'terminal';
  if (id === 'sessions' || id === 'usage') return 'sessions';
  if (id === 'editor' || isFileViewId(id)) return 'editor';
  if (isRepositoryViewId(id)) return 'files';
  if (isPullRequestsViewId(id)) return 'pull-requests';
  if (isSettingsViewId(id)) return 'settings';
  // A group chat is a tab on the Chat surface, next to the sessions.
  return 'chat';
}

interface MobileLayoutState {
  mobileSurface: MobileSurface;
  mobileTerminalOpen: boolean;
  /** The group chat the phone's Chat surface shows instead of the selected session, while one is picked. */
  mobileChatGroupId: GroupViewId | null;
}

/** Whether a dock position's content is showing: a dock on desktop, a surface on the phone. */
export function isRegionOpen(view: Pick<MobileLayoutState, 'mobileSurface' | 'mobileTerminalOpen'>, docks: Record<DockPosition, DockState>, position: DockPosition, mobile: boolean): boolean {
  if (!mobile) return docks[position].open;
  if (position === 'bottom') return view.mobileTerminalOpen;
  if (position === 'left') return view.mobileSurface === 'sessions';
  return view.mobileSurface === 'files' || view.mobileSurface === 'editor';
}

interface WorkspaceViewStore extends MobileLayoutState {
  layout: WorkspaceViewLayout;
  setMobileSurface: (surface: MobileSurface) => void;
  setMobileTerminalOpen: (open: boolean) => void;
  /** Picks a group chat tab on the phone's Chat surface; null returns to the selected session. */
  setMobileChatGroup: (id: GroupViewId | null) => void;
  /**
   * Bring a view in front of the user on either layout: select its tab and
   * open its dock on desktop, switch to its surface on the phone.
   */
  showView: (id: WorkspaceViewId) => void;
  /** Take a view out of the way: hide it on desktop, return to the surface behind it on the phone. */
  closeView: (id: WorkspaceViewId) => void;
  /** The header toggles: a dock on desktop, the matching surface on the phone. */
  toggleRegion: (position: DockPosition) => void;
  ensureViews: (ids: WorkspaceViewId[]) => void;
  activateView: (id: WorkspaceViewId) => void;
  moveView: (id: WorkspaceViewId, destination: string, beforeId?: WorkspaceViewId | null) => void;
  splitView: (id: WorkspaceViewId, direction: SplitDirection, available: readonly WorkspaceViewId[]) => string | null;
  resizeSplit: (id: string, ratio: number) => void;
  hideView: (id: WorkspaceViewId) => void;
  /** Open a pull requests or settings tab in the center (its surface on the phone), moving it back there if it was docked elsewhere. */
  openInCenter: (id: PullRequestsViewId | SettingsViewId | GroupViewId) => void;
  removeView: (id: ResourceViewId) => void;
  replaceView: (id: SessionViewId, replacement: SessionViewId) => void;
  resetLayout: () => void;
}

export const useWorkspaceViewStore = create<WorkspaceViewStore>((set, get) => {
  const update = (layout: WorkspaceViewLayout) => { saveLayout(layout); set({ layout }); };
  const reveal = (region: ViewRegion) => {
    if (region !== 'center') useDockStore.getState().setDockOpen(region, true);
  };
  return {
    layout: loadLayout(),
    mobileSurface: 'chat',
    mobileTerminalOpen: false,
    mobileChatGroupId: null,
    setMobileSurface: (mobileSurface) => set({ mobileSurface }),
    setMobileTerminalOpen: (mobileTerminalOpen) => set({ mobileTerminalOpen }),
    setMobileChatGroup: (mobileChatGroupId) => set({ mobileChatGroupId }),
    showView: (id) => {
      // The phone Files surface shows one repository view; remember which.
      if (isRepositoryViewId(id)) useSessionFilesStore.getState().setFilesPanelTab(id);
      if (!isMobileViewport()) { get().activateView(id); return; }
      const surface = mobileSurfaceFor(id);
      if (surface === 'terminal') set({ mobileTerminalOpen: true });
      else set({ mobileSurface: surface, ...(isGroupViewId(id) ? { mobileChatGroupId: id } : isSessionViewId(id) ? { mobileChatGroupId: null } : {}) });
    },
    closeView: (id) => {
      if (!isMobileViewport()) { get().hideView(id); return; }
      const surface = mobileSurfaceFor(id);
      if (surface === 'terminal') set({ mobileTerminalOpen: false });
      else set({ mobileSurface: surface === 'editor' ? 'files' : 'chat' });
    },
    toggleRegion: (position) => {
      if (!isMobileViewport()) { useDockStore.getState().toggleDock(position); return; }
      const state = get();
      const open = isRegionOpen(state, useDockStore.getState().docks, position, true);
      if (position === 'bottom') set({ mobileTerminalOpen: !open });
      else set({ mobileSurface: open ? 'chat' : position === 'left' ? 'sessions' : 'files' });
    },
    ensureViews: (ids) => {
      const current = get().layout;
      const resolved = resolveViewLayout(current, ids);
      if (current !== resolved) update(resolved);
    },
    activateView: (id) => {
      const layout = resolveViewLayout(get().layout, [id]);
      const region = findViewGroup(layout, id);
      if (layout.groups[region].activeId !== id || layout.hidden.includes(id)) {
        update({
          ...layout,
          groups: { ...layout.groups, [region]: { ...layout.groups[region], activeId: id } },
          hidden: layout.hidden.filter((hidden) => hidden !== id),
        });
      }
      reveal(groupRegion(layout, region));
    },
    moveView: (id, destination, beforeId) => {
      const layout = get().layout;
      if (VIEW_REGIONS.includes(destination as ViewRegion)) destination = treeGroups(layout.roots[destination as ViewRegion])[0];
      if (!Object.hasOwn(layout.groups, destination)) return;
      const source = findViewGroup(layout, id);
      const sourceRegion = groupRegion(layout, source);
      const destinationRegion = groupRegion(layout, destination);
      if (source === destination && (beforeId === undefined || beforeId === id)) { get().activateView(id); return; }
      const sourceIds = layout.groups[source].viewIds.filter((viewId) => viewId !== id);
      const destinationIds = layout.groups[destination].viewIds.filter((viewId) => viewId !== id);
      const insertionIndex = beforeId ? destinationIds.indexOf(beforeId) : -1;
      destinationIds.splice(insertionIndex < 0 ? destinationIds.length : insertionIndex, 0, id);
      update(pruneEmptyGroups({
        ...layout,
        groups: {
          ...layout.groups,
          [source]: { viewIds: sourceIds, activeId: layout.groups[source].activeId === id ? sourceIds[0] ?? null : layout.groups[source].activeId },
          [destination]: { viewIds: destinationIds, activeId: id },
        },
        hidden: layout.hidden.filter((hidden) => hidden !== id),
      }));
      if (sourceRegion !== destinationRegion && sourceRegion !== 'center' && treeGroups(get().layout.roots[sourceRegion]).every((key) => get().layout.groups[key].viewIds.every((viewId) => layout.hidden.includes(viewId)))) {
        useDockStore.getState().setDockOpen(sourceRegion, false);
      }
      reveal(destinationRegion);
    },
    splitView: (id, direction, available) => {
      const layout = resolveViewLayout(get().layout, available);
      const source = findViewGroup(layout, id);
      const region = groupRegion(layout, source);
      if (region !== 'center' && direction !== (region === 'bottom' ? 'right' : 'down')) return null;
      const visible = layout.groups[source].viewIds.filter((view) => available.includes(view) && !layout.hidden.includes(view));
      if (!visible.includes(id) || visible.length < 2 || Object.keys(layout.groups).length >= 64) return null;
      const groupId = `group-${randomUUID()}`;
      const root = mapTree(layout.roots[region], (node) => node.kind === 'group' && node.groupId === source
        ? { kind: 'split', id: `split-${randomUUID()}`, direction, ratio: 0.5, first: node, second: { kind: 'group', groupId } } : node);
      const next = { ...layout, roots: { ...layout.roots, [region]: root }, groups: {
        ...layout.groups,
        [source]: { viewIds: layout.groups[source].viewIds.filter((view) => view !== id), activeId: visible.find((view) => view !== id)! },
        [groupId]: { viewIds: [id], activeId: id },
      } };
      if (!parseViewLayout({ version: 5, ...next })) return null;
      update(next);
      reveal(region);
      return groupId;
    },
    resizeSplit: (id, ratio) => {
      if (!Number.isFinite(ratio)) return;
      const layout = get().layout;
      const roots = { ...layout.roots };
      for (const region of VIEW_REGIONS) roots[region] = mapTree(roots[region], (node) => node.kind === 'split' && node.id === id ? { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) } : node);
      update({ ...layout, roots });
    },
    hideView: (id) => {
      const layout = get().layout;
      if (layout.hidden.includes(id)) return;
      update(pruneEmptyGroups({ ...layout, hidden: [...layout.hidden, id] }));
    },
    openInCenter: (id) => {
      const layout = get().layout;
      const centerGroups = treeGroups(layout.roots.center);
      const current = Object.keys(layout.groups).find((key) => layout.groups[key].viewIds.includes(id));
      // Same placement as files: the editor's group when it is in the center.
      const editorGroup = findViewGroup(layout, 'editor');
      const target = current && centerGroups.includes(current) ? current
        : centerGroups.includes(editorGroup) ? editorGroup : centerGroups[0];
      const groups = { ...layout.groups };
      if (current && current !== target) {
        const viewIds = groups[current].viewIds.filter((viewId) => viewId !== id);
        groups[current] = { viewIds, activeId: groups[current].activeId === id ? viewIds[0] ?? null : groups[current].activeId };
      }
      groups[target] = {
        viewIds: groups[target].viewIds.includes(id) ? groups[target].viewIds : [...groups[target].viewIds, id],
        activeId: id,
      };
      update(pruneEmptyGroups({ ...layout, groups, hidden: layout.hidden.filter((viewId) => viewId !== id) }));
      set(isGroupViewId(id)
        ? { mobileSurface: 'chat', mobileChatGroupId: id }
        : { mobileSurface: isSettingsViewId(id) ? 'settings' : 'pull-requests' });
    },
    removeView: (id) => {
      const layout = get().layout;
      const region = findViewGroup(layout, id);
      const group = layout.groups[region];
      const index = group.viewIds.indexOf(id);
      if (index < 0) return;
      const viewIds = group.viewIds.filter((viewId) => viewId !== id);
      update(pruneEmptyGroups({
        ...layout,
        groups: { ...layout.groups, [region]: {
          viewIds,
          activeId: group.activeId === id ? viewIds[Math.min(index, viewIds.length - 1)] ?? null : group.activeId,
        } },
        hidden: layout.hidden.filter((viewId) => viewId !== id),
      }));
      if (get().mobileChatGroupId === id) set({ mobileChatGroupId: null });
    },
    replaceView: (id, replacement) => {
      const layout = get().layout;
      if (id === replacement) return;
      if (Object.values(layout.groups).some((group) => group.viewIds.includes(replacement))) {
        get().removeView(id);
        get().activateView(replacement);
        return;
      }
      const region = findViewGroup(layout, id);
      const group = layout.groups[region];
      update({
        ...layout,
        groups: { ...layout.groups, [region]: {
          viewIds: group.viewIds.includes(id) ? group.viewIds.map((view) => view === id ? replacement : view) : [...group.viewIds, replacement],
          activeId: group.activeId === id ? replacement : group.activeId,
        } },
        hidden: layout.hidden.map((view) => view === id ? replacement : view),
      });
    },
    resetLayout: () => {
      const layout = get().layout;
      // Open files, sessions, and pull requests stay open in their default places.
      const resources = Object.values(layout.groups).flatMap((group) => group.viewIds.filter(isResourceViewId));
      update(resolveViewLayout(createDefaultViewLayout(), resources));
      useDockStore.getState().setDockOpen('left', true);
      useDockStore.getState().setDockOpen('right', false);
      useDockStore.getState().setDockOpen('bottom', false);
    },
  };
});
