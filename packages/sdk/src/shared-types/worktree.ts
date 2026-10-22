export type ManagedWorktreeState = 'available' | 'removing' | 'missing' | 'removed';

export interface ManagedWorktreeAttachment {
  sessionId: string;
  title: string | null;
  running: boolean;
}

/**
 * Where the worktree's setup from `.prokop/worktree.json` stands.
 * `none`: the repository has no config. `ready`: files, env and ports are in
 * place. `failed`: a step refused or broke; `error` says which.
 * `needs_approval`, `running` and `interrupted` belong to background setup
 * commands.
 */
export type WorktreeSetupState =
  | 'none'
  | 'needs_approval'
  | 'running'
  | 'ready'
  | 'failed'
  | 'interrupted';

export interface WorktreeSetupPorts {
  base: number;
  count: number;
}

export interface WorktreeSetupCommands {
  setup: string[];
  teardown: string[];
}

export interface WorktreeSetup {
  state: WorktreeSetupState;
  ports: WorktreeSetupPorts | null;
  /** The current or failed step, for example "copy .env". */
  step: string | null;
  error: string | null;
  /** Non-fatal notes, for example a skipped clone. */
  warning: string | null;
  /** The commands the config declares, shown before they are approved. */
  commands: WorktreeSetupCommands;
}

export interface ManagedWorktree {
  id: string;
  name: string;
  workspaceId: string;
  repositoryId: string;
  path: string;
  branch: string | null;
  head: string | null;
  state: ManagedWorktreeState;
  dirty: boolean;
  untrackedCount: number;
  attachments: ManagedWorktreeAttachment[];
  setup: WorktreeSetup;
  createdAt: string;
  updatedAt: string;
}

export interface SessionWorktreeBinding {
  id: string;
  name: string;
  branch: string | null;
  path: string;
  state: ManagedWorktreeState;
}

export type GitWorktreeRefKind = 'local' | 'remote';

export interface GitWorktreeRef {
  name: string;
  ref: string;
  kind: GitWorktreeRefKind;
  commit: string;
  current: boolean;
  checkedOut: boolean;
}

export interface CreateManagedWorktreeInput {
  name: string;
  /** `refs/heads/<name>`: an existing local branch, or the branch to create when `createBranchFrom` is set. */
  branch: string;
  /** Create `branch` from this local branch (or `HEAD`) instead of checking out an existing one. */
  createBranchFrom?: string;
}
