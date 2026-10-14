import { getDatabase } from '@/infrastructure/sqlite/database';
import {
  deleteHarnessState, findHarnessState, getHarnessState, insertHarnessState, putHarnessState, updateHarnessState,
  type HarnessStateRecord,
} from '@/infrastructure/sqlite/harness-state';

/**
 * Claude Code native records: the session binding, rollback and fork
 * intents, inherited user IDs and the model selection. Readers keep the
 * row shapes the harness used with the former `claude_*` tables.
 */

const key = (kind: string, id: string) => ({ harness: 'claude-cli' as const, kind, key: id });

export interface ClaudeBindingRow {
  native_session_id: string;
  workspace_root: string;
  cli_version: string;
  pending: number;
}

interface BindingValue { nativeSessionId: string; workspaceRoot: string; cliVersion: string; pending: boolean }

function bindingRecord(sessionId: string, value: BindingValue): HarnessStateRecord<BindingValue> {
  return { ...key('binding', sessionId), sessionId, lookup: value.nativeSessionId, blocksSwitch: value.pending, value };
}

export function getClaudeBinding(sessionId: string): ClaudeBindingRow | null {
  const value = getHarnessState<BindingValue>(key('binding', sessionId))?.value;
  return value ? {
    native_session_id: value.nativeSessionId, workspace_root: value.workspaceRoot,
    cli_version: value.cliVersion, pending: value.pending ? 1 : 0,
  } : null;
}

/** Some Prokop session is already bound to this native Claude session. */
export function isClaudeNativeSessionBound(nativeSessionId: string): boolean {
  return !!findHarnessState('claude-cli', 'binding', nativeSessionId);
}

/** Inserts a binding; throws when the session or the native session is already bound. */
export function insertClaudeBinding(sessionId: string, nativeSessionId: string, workspaceRoot: string,
  cliVersion: string, pending: boolean): void {
  insertHarnessState(bindingRecord(sessionId, { nativeSessionId, workspaceRoot, cliVersion, pending }));
}

/** Marks the bound turn pending with the current CLI version. */
export function markClaudeBindingPending(sessionId: string, cliVersion: string): void {
  updateHarnessState<BindingValue>(key('binding', sessionId), current => current
    ? bindingRecord(sessionId, { ...current.value, pending: true, cliVersion }) : undefined);
}

/** Releases the pending turn. With `nativeSessionId`, only that binding while it is pending. */
export function releaseClaudeBinding(sessionId: string, nativeSessionId?: string): void {
  updateHarnessState<BindingValue>(key('binding', sessionId), (current) => {
    if (!current) return undefined;
    if (nativeSessionId !== undefined && (current.value.nativeSessionId !== nativeSessionId || !current.value.pending)) {
      return undefined;
    }
    return bindingRecord(sessionId, { ...current.value, pending: false });
  });
}

/** Moves an idle binding to a forked native session. False when the binding changed. */
export function rebindClaudeSession(sessionId: string, fromNativeId: string | null, toNativeId: string): boolean {
  return updateHarnessState<BindingValue>(key('binding', sessionId), current =>
    current && current.value.nativeSessionId === fromNativeId && !current.value.pending
      ? bindingRecord(sessionId, { ...current.value, nativeSessionId: toNativeId }) : undefined);
}

/** Drops the binding when it still points at `nativeSessionId`. */
export function deleteClaudeBinding(sessionId: string, nativeSessionId: string): void {
  updateHarnessState<BindingValue>(key('binding', sessionId), current =>
    current?.value.nativeSessionId === nativeSessionId ? null : undefined);
}

interface IntentValue { operation: 'edit' | 'revert'; targetMessageId: string; phase: 'fork' | 'ready' | 'sent' }

export function getClaudeRollbackIntent(sessionId: string): { phase: string; target_message_id: string } | null {
  const value = getHarnessState<IntentValue>(key('rollback-intent', sessionId))?.value;
  return value ? { phase: value.phase, target_message_id: value.targetMessageId } : null;
}

/** Starts or restarts a rollback in the fork phase. */
export function startClaudeRollbackIntent(sessionId: string, operation: 'edit' | 'revert', targetMessageId: string): void {
  putHarnessState({ ...key('rollback-intent', sessionId), sessionId, blocksSwitch: true,
    value: { operation, targetMessageId, phase: 'fork' } satisfies IntentValue });
}

/** Moves the intent to `to`; with `from`, only from that phase. */
export function setClaudeRollbackPhase(sessionId: string, to: IntentValue['phase'], from?: IntentValue['phase']): void {
  updateHarnessState<IntentValue>(key('rollback-intent', sessionId), current =>
    current && (from === undefined || current.value.phase === from)
      ? { ...current, value: { ...current.value, phase: to } } : undefined);
}

/** Drops the intent; with `phase`, only in that phase. */
export function deleteClaudeRollbackIntent(sessionId: string, phase?: IntentValue['phase']): void {
  updateHarnessState<IntentValue>(key('rollback-intent', sessionId), current =>
    current && (phase === undefined || current.value.phase === phase) ? null : undefined);
}

export function hasClaudeForkIntent(sessionId: string): boolean {
  return !!getHarnessState(key('fork-intent', sessionId));
}

export function insertClaudeForkIntent(sessionId: string, targetMessageId: string): void {
  insertHarnessState({ ...key('fork-intent', sessionId), sessionId, blocksSwitch: true,
    value: { targetMessageId, createdAt: new Date().toISOString() } });
}

export function deleteClaudeForkIntent(sessionId: string): void {
  deleteHarnessState(key('fork-intent', sessionId));
}

/** The native user ID a forked or rolled-back local user message maps to. */
export function getClaudeInheritedUserId(messageId: string): string | null {
  return getHarnessState<{ nativeUserId: string }>(key('inherited-user', messageId))?.value.nativeUserId ?? null;
}

export function setClaudeInheritedUserId(sessionId: string, messageId: string, nativeUserId: string): void {
  putHarnessState({ ...key('inherited-user', messageId), sessionId, messageId, blocksSwitch: false,
    value: { nativeUserId } });
}

export function deleteClaudeInheritedUserId(messageId: string): void {
  deleteHarnessState(key('inherited-user', messageId));
}

export function readClaudeModelSelection(sessionId: string): { model: string; effort: string } | null {
  const value = getHarnessState<{ model: string; effort: string }>(key('model', sessionId))?.value;
  return value ? { model: value.model, effort: value.effort } : null;
}

/** Only a Claude session may hold a Claude model selection. */
export function writeClaudeModelSelection(sessionId: string, selection: { model: string; effort: string }): void {
  if (!getDatabase().query("SELECT 1 FROM sessions WHERE id = ? AND harness = 'claude-cli'").get(sessionId)) {
    throw new Error('Claude session unavailable');
  }
  putHarnessState({ ...key('model', sessionId), sessionId, blocksSwitch: false,
    value: { model: selection.model, effort: selection.effort } });
}
