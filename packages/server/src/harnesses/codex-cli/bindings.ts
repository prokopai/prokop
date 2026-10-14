import { getDatabase } from '@/infrastructure/sqlite/database';
import {
  findHarnessState, getHarnessState, insertHarnessState, updateHarnessState, type HarnessStateRecord,
} from '@/infrastructure/sqlite/harness-state';

export interface CodexBinding {
  sessionId: string;
  threadId: string;
  cliVersion: string;
  workspaceRoot: string;
  pendingTurn: boolean;
  pendingUserId: string | null;
  pendingAssistantId: string | null;
  pendingTurnId: string | null;
  goalRootTurnId: string | null;
  goalRequested: boolean;
}

type BindingValue = Omit<CodexBinding, 'sessionId'> & { createdAt: string };

const bindingKey = (sessionId: string) => ({ harness: 'codex-cli' as const, kind: 'binding', key: sessionId });

function toBinding(record: HarnessStateRecord<BindingValue> | null): CodexBinding | null {
  if (!record) return null;
  const { createdAt: _createdAt, ...value } = record.value;
  return { sessionId: record.key, ...value };
}

function bindingRecord(sessionId: string, value: BindingValue): HarnessStateRecord<BindingValue> {
  return { ...bindingKey(sessionId), sessionId, lookup: value.threadId, blocksSwitch: value.pendingTurn, value };
}

/** Applies `change` when `allowed` holds for the current binding; false otherwise. */
function updateBinding(sessionId: string, allowed: (binding: BindingValue) => boolean,
  change: (binding: BindingValue) => Partial<BindingValue>): boolean {
  return updateHarnessState<BindingValue>(bindingKey(sessionId), (current) => {
    if (!current || !allowed(current.value)) return undefined;
    return bindingRecord(sessionId, { ...current.value, ...change(current.value) });
  });
}

export function getCodexBinding(sessionId: string): CodexBinding | null {
  return toBinding(getHarnessState<BindingValue>(bindingKey(sessionId)));
}

/** The Prokop session bound to a Codex thread, if any. */
export function findCodexBindingByThread(threadId: string): CodexBinding | null {
  return toBinding(findHarnessState<BindingValue>('codex-cli', 'binding', threadId));
}

export function bindCodexThread(binding: Pick<CodexBinding, 'sessionId' | 'threadId' | 'cliVersion' | 'workspaceRoot'>): void {
  // Never rebind an existing Prokop session or silently switch a Codex thread:
  // the key and the thread lookup are both unique, so a second bind throws.
  if (!getDatabase().query("SELECT 1 FROM sessions WHERE id = ? AND harness = 'codex-cli'").get(binding.sessionId)) {
    throw new Error('Codex session no longer exists');
  }
  insertHarnessState(bindingRecord(binding.sessionId, {
    threadId: binding.threadId, cliVersion: binding.cliVersion, workspaceRoot: binding.workspaceRoot,
    createdAt: new Date().toISOString(), pendingTurn: false, pendingUserId: null, pendingAssistantId: null,
    pendingTurnId: null, goalRootTurnId: null, goalRequested: false,
  }));
}

/** Records the CLI that last resumed the thread. Upgrades never strand a session. */
export function recordCodexCliVersion(sessionId: string, version: string): void {
  updateBinding(sessionId, () => true, () => ({ cliVersion: version }));
}

export function markCodexTurnPending(sessionId: string, userId: string, assistantId: string): void {
  if (!updateBinding(sessionId, binding => !binding.pendingTurn, () => ({
    pendingTurn: true, pendingUserId: userId, pendingAssistantId: assistantId, pendingTurnId: null,
    goalRootTurnId: null, goalRequested: false,
  }))) throw new Error('Codex turn requires reconciliation before another send');
}

export function markCodexTurnStarted(sessionId: string, turnId: string, assistantId: string,
  continuation: boolean): void {
  if (!updateBinding(sessionId,
    binding => binding.pendingTurn && binding.pendingUserId !== null
      && (binding.pendingTurnId === null || continuation && binding.goalRootTurnId !== null),
    binding => ({
      pendingTurnId: turnId, pendingAssistantId: assistantId,
      goalRootTurnId: continuation ? binding.goalRootTurnId : turnId,
    }))) throw new Error('Codex continuation identity is unavailable');
}

/** A steered message starts a new reply in the same pending turn; recovery fills that reply. */
export function markCodexSteerReply(sessionId: string, assistantId: string): void {
  if (!updateBinding(sessionId, binding => binding.pendingTurn, () => ({ pendingAssistantId: assistantId }))) {
    throw new Error('Codex steer has no pending turn');
  }
}

export function markCodexGoalRequested(sessionId: string): void {
  if (!updateBinding(sessionId, binding => binding.pendingTurn && binding.pendingTurnId !== null,
    () => ({ goalRequested: true }))) throw new Error('Codex goal activation has no turn identity');
}

export function markCodexGoalUncertain(sessionId: string): void {
  updateBinding(sessionId, () => true, () => ({ goalRequested: true }));
}

export function markCodexTurnCompleted(sessionId: string): void {
  updateBinding(sessionId, () => true, () => ({
    pendingTurn: false, pendingUserId: null, pendingAssistantId: null,
    pendingTurnId: null, goalRootTurnId: null, goalRequested: false,
  }));
}
