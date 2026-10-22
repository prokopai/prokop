/**
 * Running delegated tasks after the parent stopped waiting. A task is
 * watched when it starts async, or when a wait ends early (timeout, or the
 * child asked something); its result then reaches the parent as a delivered
 * message, and an ask on the child wakes the parent. Nothing polls: the run
 * promise and the host's ask notices drive everything.
 */

import type { Session, SessionHarness } from '@prokopai/sdk/types';
import type { DelegationAskNotice, DelegationHostPort } from '@prokopai/core/application/ports/delegation-host';
import { delegationHost } from '@prokopai/core/application/ports/delegation-host';
import type { SubagentOutput } from '#agent/harnesses/prokop/subagent/task-tool';

export interface TaskHandle {
  taskId: string;
  parentSessionId: string;
  description: string;
  harness: SessionHarness;
  model: string | null;
  run: Promise<SubagentOutput>;
}

export type TaskWaitOutcome =
  | { kind: 'done'; output: SubagentOutput }
  | { kind: 'timeout' }
  | { kind: 'ask' };

export interface TaskRegistryDeps {
  host: Pick<DelegationHostPort, 'deliver' | 'onAskCreated' | 'hasPendingAsk'>;
  getSession: (id: string) => Session | null | Promise<Session | null>;
}

export interface TaskRegistry {
  /** Waits for the run, a timeout, or an ask on the child, whichever comes first. */
  wait(handle: TaskHandle, timeoutMs: number): Promise<TaskWaitOutcome>;
  /** From now on the parent hears about this task through deliveries. */
  watch(handle: TaskHandle): void;
  isWatched(taskId: string): boolean;
}

export const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;

function label(handle: TaskHandle): string {
  return `task ${handle.taskId} "${handle.description}" on ${handle.harness}/${handle.model ?? 'default'}`;
}

/** The message the parent receives when a watched task settles. */
export function finishedTaskMessage(handle: TaskHandle, output: SubagentOutput): string {
  if (output.error && !output.result) return `[${label(handle)} failed]\n${output.error}`;
  const lines = [`[${label(handle)} finished]`, output.result];
  if (output.error) lines.push(`Note: ${output.error}`);
  return lines.join('\n');
}

export function askTaskMessage(handle: TaskHandle, ask: DelegationAskNotice): string {
  return `[${label(handle)} needs an answer]\nIt is waiting on ${ask.toolName}; the user sees the question here. `
    + 'Answer it if it is yours to answer, otherwise tell the user what it waits for.';
}

export function createTaskRegistry(deps: TaskRegistryDeps): TaskRegistry {
  const watched = new Map<string, TaskHandle>();
  const serials = new Map<string, number>();
  let unsubscribe: (() => void) | null = null;

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
      const serial = (serials.get(handle.taskId) ?? 0) + 1;
      serials.set(handle.taskId, serial);
      handle.run
        .then((output) => deps.host.deliver({
          sessionId: handle.parentSessionId,
          content: finishedTaskMessage(handle, output),
          key: `task-result:${handle.taskId}:${serial}`,
        }))
        .catch((error: unknown) => deps.host.deliver({
          sessionId: handle.parentSessionId,
          content: `[${label(handle)} failed]\n${error instanceof Error ? error.message : String(error)}`,
          key: `task-result:${handle.taskId}:${serial}`,
        }).catch(() => undefined))
        .finally(() => release(handle.taskId));
    },

    isWatched(taskId) {
      return watched.has(taskId);
    },
  };
}

let shared: TaskRegistry | null = null;

/** The process-wide registry over the installed delegation host. */
export function getTaskRegistry(getSession: TaskRegistryDeps['getSession']): TaskRegistry {
  if (!shared) shared = createTaskRegistry({ host: delegationHost(), getSession });
  return shared;
}
