import type { SessionHarness } from '@prokopai/sdk';

/** An ask (permission or question) that just opened on a session. */
export interface DelegationAskNotice {
  sessionId: string;
  requestId: string;
  toolName: string;
}

/**
 * A delegated task's durable row: who asked, which child, how many runs,
 * and whether the parent still owes a delivery. Keyed by the child session,
 * so it goes when the child goes. `requestKey` makes a retried call return
 * the same task.
 */
export interface DelegatedTaskRecord {
  taskId: string;
  parentSessionId: string;
  /** `child`: a subagent in the parent's checkout. `launch`: a top-level session in its own worktree. */
  kind: 'child' | 'launch';
  worktreeId: string | null;
  branch: string | null;
  requestKey: string | null;
  description: string;
  harness: SessionHarness;
  model: string | null;
  /** Runs of this child so far (a resume starts a new one). */
  serial: number;
  /** The parent stopped waiting on the current run; its result must be delivered. */
  watched: boolean;
  /** The current run finished. */
  settled: boolean;
  /** The last serial whose result reached the parent. */
  deliveredSerial: number;
  createdAt: string;
  updatedAt: string;
}

export interface DelegatedTaskStore {
  get(taskId: string): DelegatedTaskRecord | null;
  findByRequest(parentSessionId: string, requestKey: string): DelegatedTaskRecord | null;
  /** Every task the session started, children and launches. */
  listByParent(parentSessionId: string): DelegatedTaskRecord[];
  upsert(record: DelegatedTaskRecord): void;
  /** Watched, settled, and not yet delivered: what a restart has to catch up on. */
  listUndelivered(): DelegatedTaskRecord[];
}

/** An in-memory store for hosts and tests without persistence. */
export function createMemoryDelegatedTaskStore(): DelegatedTaskStore {
  const rows = new Map<string, DelegatedTaskRecord>();
  return {
    get: (taskId) => rows.get(taskId) ?? null,
    findByRequest: (parentSessionId, requestKey) =>
      [...rows.values()].find((row) => row.parentSessionId === parentSessionId && row.requestKey === requestKey) ?? null,
    listByParent: (parentSessionId) => [...rows.values()].filter((row) => row.parentSessionId === parentSessionId),
    upsert: (record) => { rows.set(record.taskId, record); },
    listUndelivered: () => [...rows.values()].filter((row) => row.watched && row.settled && row.deliveredSerial < row.serial),
  };
}

/** What a launch needs from the host: a worktree on a fresh branch, and its changes when done. */
export interface DelegationWorktreeHost {
  /** The workspace's checked-out branch, the default base for a launch; null outside a Git repository. */
  currentBranch(workspaceId: string): Promise<string | null>;
  /**
   * A managed worktree on a new branch named `branch` (suffixed when taken)
   * created from `baseBranch`, with the repository's worktree setup applied.
   */
  createWorktree(input: { workspaceId: string; branch: string; baseBranch: string }):
    Promise<{ ok: true; worktreeId: string; path: string; branch: string } | { ok: false; error: string }>;
  /** Uncommitted changes in the worktree, for the finish note; null when unknown. */
  worktreeChanges(worktreeId: string): Promise<{ changedFiles: number; branch: string | null; path: string } | null>;
}

/**
 * What the host knows about harnesses that a delegation needs before a child
 * exists (enabled in settings, installed on this machine, children allowed
 * per root), and what a running task needs from the host afterwards: a way
 * to put a result in front of the parent, to hear about a child's asks, to
 * stop a child, and durable task rows. Installed by the server bootstrap;
 * without it every harness counts as enabled and available, deliveries go
 * nowhere and tasks live in memory, so tests and single-harness hosts need
 * no wiring.
 */
export interface DelegationHostPort {
  harnessEnabled(harness: SessionHarness): boolean;
  harnessAvailable(harness: SessionHarness): boolean;
  /** Running children allowed per root session. */
  maxChildren(): number;
  /** Puts a message in front of a session's model (the delivery primitive). */
  deliver(input: { sessionId: string; content: string; key: string }): Promise<void>;
  /** Fires for every ask opened on any session; returns the unsubscribe. */
  onAskCreated(listener: (ask: DelegationAskNotice) => void): () => void;
  /** Whether the session or one of its descendants has an open ask. */
  hasPendingAsk(sessionId: string): boolean;
  /** Stops a session's turn (cancel). */
  interrupt(sessionId: string, reason: string): Promise<void>;
  tasks: DelegatedTaskStore;
  /** Running top-level launches allowed per orchestrating session. */
  maxLaunches(): number;
  /** Absent: this host cannot create worktrees, launches are refused. */
  worktrees?: DelegationWorktreeHost;
}

export const DEFAULT_MAX_DELEGATION_CHILDREN = 4;

const permissive: DelegationHostPort = {
  harnessEnabled: () => true,
  harnessAvailable: () => true,
  maxChildren: () => DEFAULT_MAX_DELEGATION_CHILDREN,
  deliver: async () => {},
  onAskCreated: () => () => {},
  hasPendingAsk: () => false,
  interrupt: async () => {},
  tasks: createMemoryDelegatedTaskStore(),
  maxLaunches: () => 3,
};

let current: DelegationHostPort = permissive;

export function installDelegationHost(port: DelegationHostPort | null): void {
  current = port ?? permissive;
}

export function delegationHost(): DelegationHostPort {
  return current;
}
