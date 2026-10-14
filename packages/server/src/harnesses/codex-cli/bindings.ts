import type { NativeRecord } from '@prokopai/core/infrastructure/storage/contracts';
import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { insertNative, updateNative, withinTransaction, type StoreTransaction } from '@prokopai/core/infrastructure/storage/transaction';

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

function toBinding(record: NativeRecord<BindingValue> | null): CodexBinding | null {
  if (!record) return null;
  const { createdAt: _createdAt, ...value } = record.value;
  return { sessionId: record.key, ...value };
}

function bindingRecord(sessionId: string, value: BindingValue): NativeRecord<BindingValue> {
  return { ...bindingKey(sessionId), sessionId, lookup: value.threadId, blocksSwitch: value.pendingTurn, value };
}

/**
 * Applies `change` when `allowed` holds for the current binding; false
 * otherwise. Runs in `tx` when given, else commits on its own.
 */
function updateBinding(tx: StoreTransaction | undefined, sessionId: string, allowed: (binding: BindingValue) => boolean,
  change: (binding: BindingValue) => Partial<BindingValue>): Promise<boolean> {
  return withinTransaction(tx, tx => updateNative<BindingValue>(tx, bindingKey(sessionId), (current) => {
    if (!current || !allowed(current.value)) return undefined;
    return bindingRecord(sessionId, { ...current.value, ...change(current.value) });
  }));
}

export async function getCodexBinding(sessionId: string): Promise<CodexBinding | null> {
  return toBinding(await getStorage().native.get<BindingValue>(bindingKey(sessionId)));
}

/** The Prokop session bound to a Codex thread, if any. */
export async function findCodexBindingByThread(threadId: string): Promise<CodexBinding | null> {
  return toBinding(await getStorage().native.find<BindingValue>('codex-cli', 'binding', threadId));
}

/**
 * Never rebind an existing Prokop session or silently switch a Codex thread:
 * the key and the thread lookup are both unique, so a second bind fails.
 */
export async function bindCodexThread(binding: Pick<CodexBinding, 'sessionId' | 'threadId' | 'cliVersion' | 'workspaceRoot'>,
  tx?: StoreTransaction, options: { createdInTransaction?: boolean } = {}): Promise<void> {
  await withinTransaction(tx, (tx) => {
    // Checks run before writes, so a session created in the same commit is not checked.
    if (!options.createdInTransaction) {
      tx.check({ check: 'session.harness', sessionId: binding.sessionId, harness: 'codex-cli' },
        new Error('Codex session no longer exists'));
    }
    insertNative(tx, bindingRecord(binding.sessionId, {
      threadId: binding.threadId, cliVersion: binding.cliVersion, workspaceRoot: binding.workspaceRoot,
      createdAt: new Date().toISOString(), pendingTurn: false, pendingUserId: null, pendingAssistantId: null,
      pendingTurnId: null, goalRootTurnId: null, goalRequested: false,
    }), new Error('Codex session or thread is already bound'));
  });
}

/** Records the CLI that last resumed the thread. Upgrades never strand a session. */
export async function recordCodexCliVersion(sessionId: string, version: string): Promise<void> {
  await updateBinding(undefined, sessionId, () => true, () => ({ cliVersion: version }));
}

export async function markCodexTurnPending(tx: StoreTransaction | undefined, sessionId: string, userId: string,
  assistantId: string): Promise<void> {
  if (!await updateBinding(tx, sessionId, binding => !binding.pendingTurn, () => ({
    pendingTurn: true, pendingUserId: userId, pendingAssistantId: assistantId, pendingTurnId: null,
    goalRootTurnId: null, goalRequested: false,
  }))) throw new Error('Codex turn requires reconciliation before another send');
}

export async function markCodexTurnStarted(sessionId: string, turnId: string, assistantId: string,
  continuation: boolean): Promise<void> {
  if (!await updateBinding(undefined, sessionId,
    binding => binding.pendingTurn && binding.pendingUserId !== null
      && (binding.pendingTurnId === null || continuation && binding.goalRootTurnId !== null),
    binding => ({
      pendingTurnId: turnId, pendingAssistantId: assistantId,
      goalRootTurnId: continuation ? binding.goalRootTurnId : turnId,
    }))) throw new Error('Codex continuation identity is unavailable');
}

/** A steered message starts a new reply in the same pending turn; recovery fills that reply. */
export async function markCodexSteerReply(tx: StoreTransaction, sessionId: string, assistantId: string): Promise<void> {
  if (!await updateBinding(tx, sessionId, binding => binding.pendingTurn, () => ({ pendingAssistantId: assistantId }))) {
    throw new Error('Codex steer has no pending turn');
  }
}

export async function markCodexGoalRequested(tx: StoreTransaction, sessionId: string): Promise<void> {
  if (!await updateBinding(tx, sessionId, binding => binding.pendingTurn && binding.pendingTurnId !== null,
    () => ({ goalRequested: true }))) throw new Error('Codex goal activation has no turn identity');
}

export async function markCodexGoalUncertain(sessionId: string): Promise<void> {
  await updateBinding(undefined, sessionId, () => true, () => ({ goalRequested: true }));
}

export async function markCodexTurnCompleted(sessionId: string, tx?: StoreTransaction): Promise<void> {
  await updateBinding(tx, sessionId, () => true, () => ({
    pendingTurn: false, pendingUserId: null, pendingAssistantId: null,
    pendingTurnId: null, goalRootTurnId: null, goalRequested: false,
  }));
}
