import type { Session, Workspace } from '@prokopai/sdk';
import { getRuntimeHost } from '@/infrastructure/runtime/host';

/**
 * CLI turns need a real root on disk. Virtual workspaces qualify: "virtual"
 * only means Prokop created the folder (default workspaces, agent homes)
 * instead of the user choosing one. Type guard: after a passing call the
 * workspace is non-null with a path.
 */
export function cliWorkspaceAvailable(workspace: Workspace | null | undefined): workspace is Workspace {
  return Boolean(workspace?.path);
}

/**
 * The directory a CLI turn runs in: the session's managed worktree when one
 * is selected, else the workspace folder. Resolved by the host (worktree
 * ownership and state; a missing worktree directory is marked missing).
 * Null when the selected root is unavailable; callers report it in their own words.
 */
export async function resolveCliRoot(
  session: Pick<Session, 'id' | 'workspaceId' | 'workspaceRootId'>, workspace: Workspace,
): Promise<string | null> {
  const resolve = getRuntimeHost().workspace.resolveSessionWorkspace;
  if (!session.workspaceRootId) return workspace.path;
  if (!resolve) return null;
  try {
    return (await resolve({ sessionId: session.id, workspaceId: session.workspaceId,
      workspaceRootId: session.workspaceRootId, workspacePath: workspace.path })).workspacePath ?? null;
  } catch {
    return null;
  }
}
