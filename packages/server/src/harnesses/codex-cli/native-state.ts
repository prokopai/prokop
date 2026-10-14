import { getDatabase } from '@/infrastructure/sqlite/database';
import {
  deleteHarnessState, getHarnessState, insertHarnessState, putHarnessState, updateHarnessState,
} from '@/infrastructure/sqlite/harness-state';

/** Codex native records other than the thread binding (see bindings.ts). */

const key = (kind: string, id: string) => ({ harness: 'codex-cli' as const, kind, key: id });

export interface RollbackIntentValue {
  operation: 'edit' | 'revert';
  targetMessageId: string;
  content: string | null;
  beforeTurnId: string;
  turnIds: string[];
  phase: 'rollback' | 'ready' | 'sent';
}

export function readCodexRollbackIntent(sessionId: string): RollbackIntentValue | null {
  return getHarnessState<RollbackIntentValue>(key('rollback-intent', sessionId))?.value ?? null;
}

/** A second intent for the same session throws, like the former primary key. */
export function insertCodexRollbackIntent(sessionId: string, value: RollbackIntentValue): void {
  insertHarnessState({ ...key('rollback-intent', sessionId), sessionId, blocksSwitch: true, value });
}

export function patchCodexRollbackIntent(sessionId: string, patch: Partial<RollbackIntentValue>): void {
  updateHarnessState<RollbackIntentValue>(key('rollback-intent', sessionId),
    current => current ? { ...current, value: { ...current.value, ...patch } } : undefined);
}

export function deleteCodexRollbackIntent(sessionId: string): void {
  deleteHarnessState(key('rollback-intent', sessionId));
}

export function hasCodexForkIntent(sessionId: string): boolean {
  return !!getHarnessState(key('fork-intent', sessionId));
}

export function insertCodexForkIntent(sessionId: string, targetMessageId: string, beforeTurnId: string): void {
  insertHarnessState({ ...key('fork-intent', sessionId), sessionId, blocksSwitch: true,
    value: { targetMessageId, beforeTurnId, createdAt: new Date().toISOString() } });
}

export function deleteCodexForkIntent(sessionId: string): void {
  deleteHarnessState(key('fork-intent', sessionId));
}

/** The Codex client ID a forked user message inherited from its source. */
export function codexInheritedUserId(messageId: string): string | null {
  return getHarnessState<{ upstreamClientId: string }>(key('inherited-user', messageId))?.value.upstreamClientId ?? null;
}

export function insertCodexInheritedUserId(sessionId: string, messageId: string, upstreamClientId: string): void {
  insertHarnessState({ ...key('inherited-user', messageId), sessionId, messageId, blocksSwitch: false,
    value: { upstreamClientId } });
}

export function deleteCodexInheritedUserId(messageId: string): void {
  deleteHarnessState(key('inherited-user', messageId));
}

export function readCodexModelSelection(sessionId: string): { model: string; effort: string } | null {
  const value = getHarnessState<{ model: string; effort: string }>(key('model', sessionId))?.value;
  return value ? { model: value.model, effort: value.effort } : null;
}

/** Only a Codex session may hold a Codex model selection. */
export function writeCodexModelSelection(sessionId: string, selection: { model: string; effort: string }): void {
  if (!getDatabase().query("SELECT 1 FROM sessions WHERE id = ? AND harness = 'codex-cli'").get(sessionId)) {
    throw new Error('Codex session unavailable');
  }
  putHarnessState({ ...key('model', sessionId), sessionId, blocksSwitch: false,
    value: { model: selection.model, effort: selection.effort } });
}
