import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { insertNative, updateNative, withinTransaction, type StoreTransaction } from '@prokopai/core/infrastructure/storage/transaction';

/**
 * Codex native records other than the thread binding (see bindings.ts).
 * Writes take an optional transaction so several can commit together.
 */

const key = (kind: string, id: string) => ({ harness: 'codex-cli' as const, kind, key: id });
const read = async <V>(kind: string, id: string) => (await getStorage().native.get<V>(key(kind, id)))?.value ?? null;

export interface RollbackIntentValue {
  operation: 'edit' | 'revert';
  targetMessageId: string;
  content: string | null;
  beforeTurnId: string;
  turnIds: string[];
  phase: 'rollback' | 'ready' | 'sent';
}

export function readCodexRollbackIntent(sessionId: string): Promise<RollbackIntentValue | null> {
  return read<RollbackIntentValue>('rollback-intent', sessionId);
}

/** A second intent for the same session fails, like the former primary key. */
export async function insertCodexRollbackIntent(sessionId: string, value: RollbackIntentValue): Promise<void> {
  await withinTransaction(undefined, tx => insertNative(tx, { ...key('rollback-intent', sessionId), sessionId,
    blocksSwitch: true, value }, new Error('Another Codex rollback requires recovery')));
}

export async function patchCodexRollbackIntent(tx: StoreTransaction | undefined, sessionId: string,
  patch: Partial<RollbackIntentValue>): Promise<void> {
  await withinTransaction(tx, tx => updateNative<RollbackIntentValue>(tx, key('rollback-intent', sessionId),
    current => current ? { ...current, value: { ...current.value, ...patch } } : undefined));
}

export async function deleteCodexRollbackIntent(tx: StoreTransaction | undefined, sessionId: string): Promise<void> {
  await withinTransaction(tx, tx => {
    tx.write({ op: 'native.delete', target: key('rollback-intent', sessionId), ifExists: true });
  });
}

export async function hasCodexForkIntent(sessionId: string): Promise<boolean> {
  return !!await getStorage().native.get(key('fork-intent', sessionId));
}

export async function insertCodexForkIntent(sessionId: string, targetMessageId: string, beforeTurnId: string): Promise<void> {
  await withinTransaction(undefined, tx => insertNative(tx, { ...key('fork-intent', sessionId), sessionId,
    blocksSwitch: true, value: { targetMessageId, beforeTurnId, createdAt: new Date().toISOString() } },
  new Error('A Codex fork has an uncertain outcome; do not retry it')));
}

export function deleteCodexForkIntent(tx: StoreTransaction, sessionId: string): void {
  tx.write({ op: 'native.delete', target: key('fork-intent', sessionId), ifExists: true });
}

/** The Codex client ID a forked user message inherited from its source. */
export async function codexInheritedUserId(messageId: string): Promise<string | null> {
  return (await read<{ upstreamClientId: string }>('inherited-user', messageId))?.upstreamClientId ?? null;
}

export function insertCodexInheritedUserId(tx: StoreTransaction, sessionId: string, messageId: string,
  upstreamClientId: string): void {
  insertNative(tx, { ...key('inherited-user', messageId), sessionId, messageId, blocksSwitch: false,
    value: { upstreamClientId } });
}

export function deleteCodexInheritedUserId(tx: StoreTransaction, messageId: string): void {
  tx.write({ op: 'native.delete', target: key('inherited-user', messageId), ifExists: true });
}

export async function readCodexModelSelection(sessionId: string): Promise<{ model: string; effort: string } | null> {
  const value = await read<{ model: string; effort: string }>('model', sessionId);
  return value ? { model: value.model, effort: value.effort } : null;
}

/** Copies a model selection to another Codex session (fork). */
export function copyCodexModelSelection(tx: StoreTransaction, sessionId: string,
  selection: { model: string; effort: string }): void {
  tx.write({ op: 'native.put', record: { ...key('model', sessionId), sessionId, blocksSwitch: false,
    value: { model: selection.model, effort: selection.effort } } });
}
