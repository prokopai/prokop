import type { CodexModelSelection } from '@prokopai/sdk';
import { getDatabase } from './database';
import { getHarnessState, putHarnessState, type NativeHarness } from './harness-state';

/**
 * Host-owned Claude Code and Codex model selection (`harness_state`,
 * kind `model`). The harness reads it at turn start through the native
 * store; the host writes it when the user picks a model.
 */

const label: Record<NativeHarness, string> = { 'claude-cli': 'Claude', 'codex-cli': 'Codex' };

export function getHarnessModelSelection(harness: NativeHarness, sessionId: string): CodexModelSelection | null {
  const value = getHarnessState<{ model: string; effort: string }>({ harness, kind: 'model', key: sessionId })?.value;
  return value ? { model: value.model, effort: value.effort } : null;
}

/** Only a session of that harness may hold its model selection. */
export function saveHarnessModelSelection(harness: NativeHarness, sessionId: string, selection: CodexModelSelection): void {
  if (!getDatabase().query('SELECT 1 FROM sessions WHERE id = ? AND harness = ?').get(sessionId, harness)) {
    throw new Error(`${label[harness]} session unavailable`);
  }
  putHarnessState({ harness, kind: 'model', key: sessionId, sessionId, blocksSwitch: false,
    value: { model: selection.model, effort: selection.effort } });
}

export const getClaudeModelSelection = (sessionId: string) => getHarnessModelSelection('claude-cli', sessionId);
export const saveClaudeModelSelection = (sessionId: string, selection: CodexModelSelection) =>
  saveHarnessModelSelection('claude-cli', sessionId, selection);
export const getCodexModelSelection = (sessionId: string) => getHarnessModelSelection('codex-cli', sessionId);
export const saveCodexModelSelection = (sessionId: string, selection: CodexModelSelection) =>
  saveHarnessModelSelection('codex-cli', sessionId, selection);
