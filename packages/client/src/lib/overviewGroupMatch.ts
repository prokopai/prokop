import type { Agent, Workspace } from '@prokopai/sdk';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';

/**
 * "Add a repo" from a workspace lands in the Overview group that holds
 * exactly these workspaces, or in a new one named after them
 * (docs/plans/add-repo-overview-group.md).
 */

/** The store keeps names to 50 characters; the base leaves room for a " 2". */
const NAME_MAX = 47;

export function sameWorkspaceSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** The server's group with exactly these workspaces, in any order. */
export function findOverviewGroup(groups: readonly OverviewGroup[], serverId: string, workspaceIds: readonly string[]): OverviewGroup | null {
  return groups.find((group) => group.serverId === serverId && sameWorkspaceSet(group.workspaceIds, workspaceIds)) ?? null;
}

/** "jean2 + db-web": the display names in the given order. */
export function overviewGroupName(workspaceIds: readonly string[], workspaces: readonly Workspace[], agents: Agent[]): string {
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const names = workspaceIds.map((id) => {
    const workspace = byId.get(id);
    return workspace ? getWorkspaceDisplayName(workspace, agents) : id;
  });
  const name = names.join(' + ');
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

/** `base`, else `base 2`, `base 3`… past the names already taken (case-insensitive). */
export function uniqueOverviewGroupName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}
