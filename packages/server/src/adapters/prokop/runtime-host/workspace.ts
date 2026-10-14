import { existsSync } from 'fs';
import { getSession } from '@/infrastructure/sqlite/session-store';
import {
  addWorkspaceAdditionalPath,
  removeWorkspaceAdditionalPath,
} from '@/infrastructure/sqlite/workspaces';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import type { RuntimeHost as ProkopCompatibilityBindings } from '@/infrastructure/runtime/host';
import { createProkopToolWorkspaceHost } from '@/agent';

const managedWorktrees = createManagedWorktreeRepository(getDatabase);

/** Session roots from the host store: managed worktrees, extra roots, the session's agent. */
export const prokopWorkspaceBindings: ProkopCompatibilityBindings['workspace'] = {
  resolveSessionWorkspace: async ({ workspaceId, workspaceRootId, workspacePath, additionalPaths }) => {
    if (!workspaceRootId) return { workspacePath, additionalPaths };

    const worktree = managedWorktrees.get(workspaceRootId);
    if (
      !workspaceId
      || !worktree
      || worktree.workspaceId !== workspaceId
      || worktree.state !== 'available'
    ) {
      throw new Error('Selected worktree is not available for this workspace');
    }
    if (!existsSync(worktree.path)) {
      managedWorktrees.update(worktree.id, { state: 'missing' });
      throw new Error('Selected worktree directory is missing');
    }

    return {
      workspacePath: worktree.path,
      additionalPaths: [],
    };
  },
  createToolWorkspaceHost: options => createProkopToolWorkspaceHost(options, {
    agentIdOf: sessionId => getSession(sessionId)?.agentId,
    addRoot: addWorkspaceAdditionalPath,
    removeRoot: removeWorkspaceAdditionalPath,
  }),
};
