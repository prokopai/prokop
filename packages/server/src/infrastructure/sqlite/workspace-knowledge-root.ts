import { realpathSync } from 'fs';
import { getDatabase } from './database';

function realPath(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

/**
 * The host's knowledge root lookup: a managed worktree shares its workspace's
 * memory and skills. Installed with `configureWorkspaceKnowledgeRoot`.
 */
export function storedWorkspaceKnowledgeRoot(workingPath: string): string {
  try {
    const rows = getDatabase().query<{ worktree: string; workspace: string }, []>(`SELECT m.path AS worktree,
      w.path AS workspace FROM managed_worktrees m JOIN workspaces w ON w.id = m.workspace_id`).all();
    const exact = rows.find(row => row.worktree === workingPath);
    if (exact) return exact.workspace;
    // CLI harnesses pass the resolved root; stored paths may go through a symlink.
    const real = realPath(workingPath);
    return rows.find(row => realPath(row.worktree) === real)?.workspace ?? workingPath;
  } catch (error) {
    console.warn('[prokop] Could not look up the workspace of a worktree; using the worktree folder', error);
    return workingPath;
  }
}
