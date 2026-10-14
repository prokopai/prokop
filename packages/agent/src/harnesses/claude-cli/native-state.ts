import type { NativeRecord } from '@prokopai/core/infrastructure/storage/contracts';
import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import {
  insertNative, updateNative, withinTransaction, type StoreTransaction,
} from '@prokopai/core/infrastructure/storage/transaction';

/**
 * Claude Code native records: the session binding, rollback and fork
 * intents, inherited user IDs and the model selection. Readers keep the
 * row shapes the harness used with the former `claude_*` tables. Writes take
 * an optional transaction so several can commit together; without one each
 * commits on its own.
 */

const key = (kind: string, id: string) => ({ harness: 'claude-cli' as const, kind, key: id });
const read = async <V>(kind: string, id: string) => (await getStorage().native.get<V>(key(kind, id)))?.value ?? null;

export interface ClaudeBindingRow {
  native_session_id: string;
  workspace_root: string;
  cli_version: string;
  pending: number;
}

interface BindingValue { nativeSessionId: string; workspaceRoot: string; cliVersion: string; pending: boolean }

function bindingRecord(sessionId: string, value: BindingValue): NativeRecord<BindingValue> {
  return { ...key('binding', sessionId), sessionId, lookup: value.nativeSessionId, blocksSwitch: value.pending, value };
}

export async function getClaudeBinding(sessionId: string): Promise<ClaudeBindingRow | null> {
  const value = await read<BindingValue>('binding', sessionId);
  return value ? {
    native_session_id: value.nativeSessionId, workspace_root: value.workspaceRoot,
    cli_version: value.cliVersion, pending: value.pending ? 1 : 0,
  } : null;
}

/** Some Prokop session is already bound to this native Claude session. */
export async function isClaudeNativeSessionBound(nativeSessionId: string): Promise<boolean> {
  return !!await getStorage().native.find('claude-cli', 'binding', nativeSessionId);
}

/** Inserts a binding; fails when the session or the native session is already bound. */
export function insertClaudeBinding(tx: StoreTransaction, sessionId: string, nativeSessionId: string,
  workspaceRoot: string, cliVersion: string, pending: boolean): void {
  insertNative(tx, bindingRecord(sessionId, { nativeSessionId, workspaceRoot, cliVersion, pending }),
    new Error('Claude session is already bound'));
}

/** Marks the bound turn pending with the current CLI version. */
export async function markClaudeBindingPending(tx: StoreTransaction, sessionId: string, cliVersion: string): Promise<void> {
  await updateNative<BindingValue>(tx, key('binding', sessionId), current => current
    ? bindingRecord(sessionId, { ...current.value, pending: true, cliVersion }) : undefined);
}

/** Releases the pending turn. With `nativeSessionId`, only that binding while it is pending. */
export async function releaseClaudeBinding(tx: StoreTransaction, sessionId: string, nativeSessionId?: string): Promise<void> {
  await updateNative<BindingValue>(tx, key('binding', sessionId), (current) => {
    if (!current) return undefined;
    if (nativeSessionId !== undefined && (current.value.nativeSessionId !== nativeSessionId || !current.value.pending)) {
      return undefined;
    }
    return bindingRecord(sessionId, { ...current.value, pending: false });
  });
}

/** Moves an idle binding to a forked native session. False when the binding changed. */
export function rebindClaudeSession(tx: StoreTransaction, sessionId: string, fromNativeId: string | null,
  toNativeId: string): Promise<boolean> {
  return updateNative<BindingValue>(tx, key('binding', sessionId), current =>
    current && current.value.nativeSessionId === fromNativeId && !current.value.pending
      ? bindingRecord(sessionId, { ...current.value, nativeSessionId: toNativeId }) : undefined);
}

/** Drops the binding when it still points at `nativeSessionId`. */
export async function deleteClaudeBinding(tx: StoreTransaction, sessionId: string, nativeSessionId: string): Promise<void> {
  await updateNative<BindingValue>(tx, key('binding', sessionId), current =>
    current?.value.nativeSessionId === nativeSessionId ? null : undefined);
}

interface IntentValue { operation: 'edit' | 'revert'; targetMessageId: string; phase: 'fork' | 'ready' | 'sent' }

export async function getClaudeRollbackIntent(sessionId: string): Promise<{ phase: string; target_message_id: string } | null> {
  const value = await read<IntentValue>('rollback-intent', sessionId);
  return value ? { phase: value.phase, target_message_id: value.targetMessageId } : null;
}

/** Starts or restarts a rollback in the fork phase. */
export async function startClaudeRollbackIntent(sessionId: string, operation: 'edit' | 'revert',
  targetMessageId: string): Promise<void> {
  await withinTransaction(undefined, tx => tx.write({ op: 'native.put', record: { ...key('rollback-intent', sessionId),
    sessionId, blocksSwitch: true, value: { operation, targetMessageId, phase: 'fork' } satisfies IntentValue } }));
}

/** Moves the intent to `to`; with `from`, only from that phase. */
export async function setClaudeRollbackPhase(tx: StoreTransaction | undefined, sessionId: string,
  to: IntentValue['phase'], from?: IntentValue['phase']): Promise<void> {
  await withinTransaction(tx, tx => updateNative<IntentValue>(tx, key('rollback-intent', sessionId), current =>
    current && (from === undefined || current.value.phase === from)
      ? { ...current, value: { ...current.value, phase: to } } : undefined));
}

/** Drops the intent; with `phase`, only in that phase. */
export async function deleteClaudeRollbackIntent(tx: StoreTransaction | undefined, sessionId: string,
  phase?: IntentValue['phase']): Promise<void> {
  await withinTransaction(tx, tx => updateNative<IntentValue>(tx, key('rollback-intent', sessionId), current =>
    current && (phase === undefined || current.value.phase === phase) ? null : undefined));
}

export async function hasClaudeForkIntent(sessionId: string): Promise<boolean> {
  return !!await getStorage().native.get(key('fork-intent', sessionId));
}

export async function insertClaudeForkIntent(sessionId: string, targetMessageId: string): Promise<void> {
  await withinTransaction(undefined, tx => insertNative(tx, { ...key('fork-intent', sessionId), sessionId,
    blocksSwitch: true, value: { targetMessageId, createdAt: new Date().toISOString() } },
  new Error('A Claude fork has an uncertain outcome; do not retry it')));
}

export function deleteClaudeForkIntent(tx: StoreTransaction, sessionId: string): void {
  tx.write({ op: 'native.delete', target: key('fork-intent', sessionId), ifExists: true });
}

/** The native user ID a forked or rolled-back local user message maps to. */
export async function getClaudeInheritedUserId(messageId: string): Promise<string | null> {
  return (await read<{ nativeUserId: string }>('inherited-user', messageId))?.nativeUserId ?? null;
}

export function setClaudeInheritedUserId(tx: StoreTransaction, sessionId: string, messageId: string,
  nativeUserId: string): void {
  tx.write({ op: 'native.put', record: { ...key('inherited-user', messageId), sessionId, messageId,
    blocksSwitch: false, value: { nativeUserId } } });
}

export function deleteClaudeInheritedUserId(tx: StoreTransaction, messageId: string): void {
  tx.write({ op: 'native.delete', target: key('inherited-user', messageId), ifExists: true });
}

export async function readClaudeModelSelection(sessionId: string): Promise<{ model: string; effort: string } | null> {
  const value = await read<{ model: string; effort: string }>('model', sessionId);
  return value ? { model: value.model, effort: value.effort } : null;
}

/** Copies a model selection to another Claude session (fork). */
export function copyClaudeModelSelection(tx: StoreTransaction, sessionId: string,
  selection: { model: string; effort: string }): void {
  tx.write({ op: 'native.put', record: { ...key('model', sessionId), sessionId, blocksSwitch: false,
    value: { model: selection.model, effort: selection.effort } } });
}
