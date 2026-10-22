import type {
  GitWorktreeRef,
  ManagedWorktree,
  ManagedWorktreeState,
  Session,
  Workspace,
  WorktreeSetupState,
} from '@prokopai/sdk';

export interface ManagedWorktreeRecord {
  id: string;
  name: string;
  workspaceId: string;
  repositoryId: string;
  repositoryRoot: string;
  path: string;
  branch: string | null;
  head: string | null;
  state: ManagedWorktreeState;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedWorktreeRepositoryPort {
  listByWorkspace(workspaceId: string): ManagedWorktreeRecord[];
  listByRepository(repositoryId: string): ManagedWorktreeRecord[];
  get(id: string): ManagedWorktreeRecord | null;
  create(record: ManagedWorktreeRecord): ManagedWorktreeRecord;
  update(
    id: string,
    updates: Partial<Pick<ManagedWorktreeRecord, 'branch' | 'head' | 'state'>>,
  ): ManagedWorktreeRecord | null;
  /** Hard-deletes a removed record. Returns true when a row was deleted. */
  delete(id: string): boolean;
}

export interface WorktreeSetupRecord {
  worktreeId: string;
  configHash: string;
  portBase: number | null;
  portCount: number | null;
  state: WorktreeSetupState;
  step: string | null;
  error: string | null;
  warning: string | null;
  updatedAt: string;
}

/** One row per worktree that has a config; purged with the worktree. */
export interface WorktreeSetupRepositoryPort {
  get(worktreeId: string): WorktreeSetupRecord | null;
  upsert(record: WorktreeSetupRecord): WorktreeSetupRecord;
  listByState(state: WorktreeSetupState): WorktreeSetupRecord[];
  /** Every stored port block, held until its worktree row is purged. */
  listPortBlocks(): Array<{ base: number; count: number }>;
  /** Commands from a repository are code: a config hash runs only once approved. */
  isApproved(repositoryId: string, configHash: string): boolean;
  approve(repositoryId: string, configHash: string, approvedAt: string): void;
}

export interface WorktreeSetupCommandResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

export interface WorktreeSetupRunningCommand {
  done: Promise<WorktreeSetupCommandResult>;
  /** Kills the whole process group. `done` still settles. */
  kill(): void;
}

/** Runs one setup command through a login shell in its own process group. */
export interface WorktreeSetupCommandPort {
  run(input: {
    cwd: string;
    command: string;
    env: Record<string, string>;
    timeoutMs: number;
    onOutput: (chunk: string) => void;
  }): WorktreeSetupRunningCommand;
}

/** Per-worktree setup output, capped at a fixed size (the tail is kept). */
export interface WorktreeSetupLogPort {
  append(worktreeId: string, text: string): Promise<void>;
  read(worktreeId: string): Promise<string>;
  remove(worktreeId: string): Promise<void>;
}

/**
 * File access for the instant setup steps. Paths are worktree- or
 * repository-relative; the adapter resolves and contains them.
 */
export interface WorktreeSetupFilesPort {
  /** The config text from the primary checkout, null when absent. */
  readConfig(repositoryTopLevel: string): Promise<string | null>;
  /** Whether `relativePath` exists under `root` without a symlink leading out. */
  sourceExists(root: string, relativePath: string): Promise<boolean>;
  /** Whether Git ignores `relativePath` inside the worktree (`git check-ignore`). */
  isIgnored(worktreePath: string, relativePath: string): Promise<boolean>;
  /** Whether writing `relativePath` under `root` stays inside `root` (no symlinked parent out). */
  isContained(root: string, relativePath: string): Promise<boolean>;
  copyFile(sourceRoot: string, worktreePath: string, relativePath: string): Promise<void>;
  /** Copy-on-write clone of a directory; rejects when the filesystem cannot. */
  cloneDirectory(sourceRoot: string, worktreePath: string, relativePath: string): Promise<void>;
  writeFile(worktreePath: string, relativePath: string, content: string): Promise<void>;
}

export interface WorktreePortProbePort {
  /** True when nothing listens on the port on loopback right now. */
  isFree(port: number): Promise<boolean>;
}

export interface WorktreeGitStatus {
  branch: string | null;
  head: string | null;
  dirty: boolean;
  untrackedCount: number;
}

export interface WorktreeRepositoryIdentity {
  repositoryId: string;
  repositoryRoot: string;
  repositoryTopLevel: string;
  selectedRoot: string;
}

export interface WorktreeGitPort {
  inspectRepository(path: string): Promise<WorktreeRepositoryIdentity>;
  listRefs(path: string): Promise<GitWorktreeRef[]>;
  create(options: {
    repositoryPath: string;
    destinationPath: string;
    branch: string;
  }): Promise<WorktreeGitStatus>;
  status(path: string): Promise<WorktreeGitStatus>;
  remove(repositoryPath: string, worktreePath: string): Promise<void>;
}

export interface WorktreeSessionPort {
  get(id: string): Session | null;
  listByWorkspace(workspaceId: string): Session[];
  updateWorkspaceRoot(id: string, workspaceRootId: string | null): Session | null;
  hasMessages(sessionId: string): boolean;
  isRunning(session: Session): boolean;
}

export interface WorktreeWorkspacePort {
  get(id: string): Workspace | null;
}

export interface WorktreeTerminalPort {
  listForWorktree(
    worktreeId: string,
    path: string,
  ): Array<{ id?: string; cwd?: string; managedWorktreeId?: string }>;
  /** Drops the managed-worktree reference from lingering terminal rows so a
   * removed worktree record can be purged despite the foreign key. */
  clearWorktreeReferences(worktreeId: string): void;
}

export interface WorktreeEventPort {
  worktreeChanged(worktree: ManagedWorktree): void;
  /** The record row was purged after removal; clients drop the worktree. */
  worktreeDeleted(worktree: ManagedWorktree): void;
  sessionChanged(session: Session): void;
}

export interface WorktreeAttachmentRefreshPort {
  changed(worktreeId: string): void;
}
