/**
 * Running delegated tasks after the parent stopped waiting. A task is
 * watched when it starts async, or when a wait ends early (timeout, or the
 * child asked something); its result then reaches the parent as a delivered
 * message, and an ask on the child wakes the parent. Nothing polls: the run
 * promise and the host's ask notices drive everything.
 */

import type { MessageWithParts, Session, SessionHarness } from '@prokopai/sdk/types';
import type { DelegationAskNotice, DelegationHostPort } from '@prokopai/core/application/ports/delegation-host';
import { delegationHost } from '@prokopai/core/application/ports/delegation-host';
import { listMessagesWithParts, getSession as runtimeGetSession } from '@prokopai/core/infrastructure/storage/runtime';
import { formatTaskOutput, lastAssistantText, type SubagentOutput } from '#agent/harnesses/prokop/subagent/task-tool';

export interface TaskHandle {
  taskId: string;
  parentSessionId: string;
  description: string;
  harness: SessionHarness;
  model: string | null;
  /** A launch: the worktree the session works in. */
  worktreeId?: string;
  branch?: string | null;
  run: Promise<SubagentOutput>;
}

export interface LaunchOutcome {
  branch: string | null;
  path: string;
  changedFiles: number;
}

export type TaskWaitOutcome =
  | { kind: 'done'; output: SubagentOutput }
  | { kind: 'timeout' }
  | { kind: 'ask' };

export interface TaskRegistryDeps {
  host: Pick<DelegationHostPort, 'deliver' | 'onAskCreated' | 'hasPendingAsk' | 'tasks'> & Partial<Pick<DelegationHostPort, 'worktrees'>>;
  getSession: (id: string) => Session | null | Promise<Session | null>;
  readTranscript?: (sessionId: string) => Promise<MessageWithParts[]>;
  now?: () => string;
}

export interface TaskRegistry {
  /** Waits for the run, a timeout, or an ask on the child, whichever comes first. */
  wait(handle: TaskHandle, timeoutMs: number): Promise<TaskWaitOutcome>;
  /** From now on the parent hears about this task through deliveries. */
  watch(handle: TaskHandle): void;
  isWatched(taskId: string): boolean;
  /**
   * Startup: a watched task whose child settled but whose result never
   * reached the parent (the process stopped in between) is delivered now
   * from the child's transcript.
   */
  recover(): Promise<number>;
}

export const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;

function label(handle: TaskHandle): string {
  const kind = handle.worktreeId ? 'launched session' : 'task';
  return `${kind} ${handle.taskId} "${handle.description}" on ${handle.harness}/${handle.model ?? 'default'}`;
}

/** The message the parent receives when a watched task settles. A launch adds what a reviewer needs. */
export function finishedTaskMessage(handle: TaskHandle, output: SubagentOutput, launch?: LaunchOutcome | null): string {
  const where = launch
    ? [
        `Branch: ${launch.branch ?? handle.branch ?? 'unknown'}`,
        `Worktree: ${launch.path}`,
        `Uncommitted changes: ${launch.changedFiles} file${launch.changedFiles === 1 ? '' : 's'}`,
        'Open that session to review and merge.',
      ]
    : [];
  if (output.error && !output.result) return [`[${label(handle)} failed]`, ...where, output.error].join('\n');
  const lines = [`[${label(handle)} finished]`, ...where, output.result];
  if (output.error) lines.push(`Note: ${output.error}`);
  return lines.join('\n');
}

export function askTaskMessage(handle: TaskHandle, ask: DelegationAskNotice): string {
  return `[${label(handle)} needs an answer]\nIt is waiting on ${ask.toolName}; the user sees the question here. `
    + 'Answer it if it is yours to answer, otherwise tell the user what it waits for.';
}

export function createTaskRegistry(deps: TaskRegistryDeps): TaskRegistry {
  const watched = new Map<string, TaskHandle>();
  let unsubscribe: (() => void) | null = null;
  const now = deps.now ?? (() => new Date().toISOString());

  /** The task's row, created when a child predates the table. */
  function rowFor(handle: TaskHandle) {
    return deps.host.tasks.get(handle.taskId) ?? {
      taskId: handle.taskId,
      parentSessionId: handle.parentSessionId,
      kind: handle.worktreeId ? 'launch' as const : 'child' as const,
      worktreeId: handle.worktreeId ?? null,
      branch: handle.branch ?? null,
      requestKey: null,
      description: handle.description,
      harness: handle.harness,
      model: handle.model,
      serial: 1,
      watched: false,
      settled: false,
      deliveredSerial: 0,
      createdAt: now(),
      updatedAt: now(),
    };
  }

  async function launchOutcome(handle: TaskHandle): Promise<LaunchOutcome | null> {
    if (!handle.worktreeId || !deps.host.worktrees) return null;
    try {
      return await deps.host.worktrees.worktreeChanges(handle.worktreeId);
    } catch {
      return null;
    }
  }

  async function deliverResult(handle: TaskHandle, serial: number, content: string): Promise<void> {
    await deps.host.deliver({ sessionId: handle.parentSessionId, content, key: `task-result:${handle.taskId}:${serial}` });
    const row = deps.host.tasks.get(handle.taskId);
    if (row) deps.host.tasks.upsert({ ...row, deliveredSerial: Math.max(row.deliveredSerial, serial), updatedAt: now() });
  }

  async function within(sessionId: string, taskId: string): Promise<boolean> {
    let current: string | null = sessionId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === taskId) return true;
      seen.add(current);
      current = (await deps.getSession(current))?.parentId ?? null;
    }
    return false;
  }

  function ensureSubscribed(): void {
    if (unsubscribe) return;
    unsubscribe = deps.host.onAskCreated((ask) => {
      void (async () => {
        for (const handle of watched.values()) {
          if (!(await within(ask.sessionId, handle.taskId))) continue;
          await deps.host.deliver({
            sessionId: handle.parentSessionId,
            content: askTaskMessage(handle, ask),
            key: `task-ask:${ask.requestId}`,
          }).catch(() => undefined);
        }
      })();
    });
  }

  function release(taskId: string): void {
    watched.delete(taskId);
    if (watched.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  return {
    async wait(handle, timeoutMs) {
      if (deps.host.hasPendingAsk(handle.taskId)) {
        // Already blocked before the wait began: do not sit on it.
        const quick = await Promise.race([
          handle.run.then((output): TaskWaitOutcome => ({ kind: 'done', output })),
          new Promise<TaskWaitOutcome>((resolve) => setTimeout(() => resolve({ kind: 'ask' }), 0)),
        ]);
        return quick;
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopAsks: () => void = () => {};
      try {
        return await Promise.race([
          handle.run.then((output): TaskWaitOutcome => ({ kind: 'done', output })),
          new Promise<TaskWaitOutcome>((resolve) => {
            timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
          }),
          new Promise<TaskWaitOutcome>((resolve) => {
            stopAsks = deps.host.onAskCreated((ask) => {
              void within(ask.sessionId, handle.taskId).then((inside) => {
                if (inside) resolve({ kind: 'ask' });
              });
            });
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        stopAsks();
      }
    },

    watch(handle) {
      if (watched.has(handle.taskId)) return;
      watched.set(handle.taskId, handle);
      ensureSubscribed();
      // The row remembers that a delivery is owed, so a restart can finish it.
      const row = rowFor(handle);
      deps.host.tasks.upsert({ ...row, watched: true, updatedAt: now() });
      const serial = row.serial;
      handle.run
        .then(async (output) => deliverResult(handle, serial, finishedTaskMessage(handle, output, await launchOutcome(handle))))
        .catch((error: unknown) => deliverResult(handle, serial,
          `[${label(handle)} failed]\n${error instanceof Error ? error.message : String(error)}`).catch(() => undefined))
        .finally(() => release(handle.taskId));
    },

    isWatched(taskId) {
      return watched.has(taskId);
    },

    async recover() {
      let delivered = 0;
      for (const row of deps.host.tasks.listUndelivered()) {
        if (watched.has(row.taskId)) continue;
        const child = await deps.getSession(row.taskId);
        if (!child) continue;
        const text = deps.readTranscript ? lastAssistantText(await deps.readTranscript(row.taskId)) : '';
        const output: SubagentOutput = child.subagentStatus === 'error' && !text
          ? { task_id: row.taskId, result: '', error: 'The task failed before its result was delivered' }
          : child.subagentStatus === 'interrupted' && !text
            ? { task_id: row.taskId, result: '', error: 'The task was interrupted before its result was delivered' }
            : { task_id: row.taskId, result: formatTaskOutput(row.taskId, text) };
        const handle: TaskHandle = {
          taskId: row.taskId,
          parentSessionId: row.parentSessionId,
          description: row.description,
          harness: row.harness,
          model: row.model,
          ...(row.worktreeId ? { worktreeId: row.worktreeId, branch: row.branch } : {}),
          run: Promise.resolve(output),
        };
        try {
          await deliverResult(handle, row.serial, finishedTaskMessage(handle, output, await launchOutcome(handle)));
          delivered += 1;
        } catch {
          // The parent may be gone; the row stays for the next start.
        }
      }
      return delivered;
    },
  };
}

let shared: TaskRegistry | null = null;

/** The process-wide registry over the installed delegation host. */
export function getTaskRegistry(getSession: TaskRegistryDeps['getSession']): TaskRegistry {
  if (!shared) shared = createTaskRegistry({ host: delegationHost(), getSession, readTranscript: listMessagesWithParts });
  return shared;
}

/** Startup hook for the host: delivers results a previous process left undelivered. */
export function recoverDelegatedTasks(): Promise<number> {
  return getTaskRegistry(runtimeGetSession).recover();
}
