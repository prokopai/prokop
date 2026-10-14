/**
 * Test access to native harness state (`harness_state`) in the row shapes of
 * the former `claude_*`/`codex_*` tables, so assertions written against those
 * tables keep their expected values.
 */
import { getDatabase } from '@/infrastructure/sqlite/database';
import {
  deleteHarnessState, getHarnessState, insertHarnessState, putHarnessState, type HarnessStateRecord, type NativeHarness,
} from '@/infrastructure/sqlite/harness-state';

type Row = Record<string, unknown>;

interface TableMapping {
  harness: NativeHarness;
  kind: string;
  keyColumn: string;
  toRow(record: HarnessStateRecord<Row>): Row;
  toRecord(row: Row): HarnessStateRecord<Row>;
}

const bool = (value: unknown): number => (value ? 1 : 0);
const messageSession = (messageId: string): string => {
  const row = getDatabase().query<{ session_id: string }, [string]>('SELECT session_id FROM messages WHERE id = ?').get(messageId);
  if (!row) throw new Error(`No message ${messageId}`);
  return row.session_id;
};

const tables: Record<string, TableMapping> = {
  claude_session_bindings: {
    harness: 'claude-cli', kind: 'binding', keyColumn: 'session_id',
    toRow: ({ key, value }) => ({ session_id: key, native_session_id: value.nativeSessionId,
      workspace_root: value.workspaceRoot, cli_version: value.cliVersion, pending: bool(value.pending) }),
    toRecord: row => ({ harness: 'claude-cli', kind: 'binding', key: String(row.session_id), sessionId: String(row.session_id),
      lookup: String(row.native_session_id), blocksSwitch: !!row.pending,
      value: { nativeSessionId: row.native_session_id, workspaceRoot: row.workspace_root,
        cliVersion: row.cli_version, pending: !!row.pending } }),
  },
  claude_rollback_intents: {
    harness: 'claude-cli', kind: 'rollback-intent', keyColumn: 'session_id',
    toRow: ({ key, value }) => ({ session_id: key, operation: value.operation,
      target_message_id: value.targetMessageId, phase: value.phase }),
    toRecord: row => ({ harness: 'claude-cli', kind: 'rollback-intent', key: String(row.session_id),
      sessionId: String(row.session_id), blocksSwitch: true,
      value: { operation: row.operation, targetMessageId: row.target_message_id, phase: row.phase } }),
  },
  claude_fork_intents: {
    harness: 'claude-cli', kind: 'fork-intent', keyColumn: 'source_session_id',
    toRow: ({ key, value }) => ({ source_session_id: key, target_message_id: value.targetMessageId, created_at: value.createdAt }),
    toRecord: row => ({ harness: 'claude-cli', kind: 'fork-intent', key: String(row.source_session_id),
      sessionId: String(row.source_session_id), blocksSwitch: true,
      value: { targetMessageId: row.target_message_id, createdAt: row.created_at ?? new Date().toISOString() } }),
  },
  claude_inherited_user_ids: {
    harness: 'claude-cli', kind: 'inherited-user', keyColumn: 'message_id',
    toRow: ({ key, value }) => ({ message_id: key, native_user_id: value.nativeUserId }),
    toRecord: row => ({ harness: 'claude-cli', kind: 'inherited-user', key: String(row.message_id),
      sessionId: messageSession(String(row.message_id)), messageId: String(row.message_id), blocksSwitch: false,
      value: { nativeUserId: row.native_user_id } }),
  },
  claude_session_models: {
    harness: 'claude-cli', kind: 'model', keyColumn: 'session_id',
    toRow: ({ key, value }) => ({ session_id: key, model: value.model, effort: value.effort }),
    toRecord: row => ({ harness: 'claude-cli', kind: 'model', key: String(row.session_id), sessionId: String(row.session_id),
      blocksSwitch: false, value: { model: row.model, effort: row.effort } }),
  },
  codex_session_bindings: {
    harness: 'codex-cli', kind: 'binding', keyColumn: 'session_id',
    toRow: ({ key, value }) => ({ session_id: key, thread_id: value.threadId, cli_version: value.cliVersion,
      workspace_root: value.workspaceRoot, created_at: value.createdAt, pending_turn: bool(value.pendingTurn),
      pending_user_id: value.pendingUserId, pending_assistant_id: value.pendingAssistantId,
      pending_turn_id: value.pendingTurnId, goal_root_turn_id: value.goalRootTurnId,
      goal_requested: bool(value.goalRequested) }),
    toRecord: row => ({ harness: 'codex-cli', kind: 'binding', key: String(row.session_id), sessionId: String(row.session_id),
      lookup: String(row.thread_id), blocksSwitch: !!row.pending_turn,
      value: { threadId: row.thread_id, cliVersion: row.cli_version, workspaceRoot: row.workspace_root,
        createdAt: row.created_at ?? new Date().toISOString(), pendingTurn: !!row.pending_turn,
        pendingUserId: row.pending_user_id ?? null, pendingAssistantId: row.pending_assistant_id ?? null,
        pendingTurnId: row.pending_turn_id ?? null, goalRootTurnId: row.goal_root_turn_id ?? null,
        goalRequested: !!row.goal_requested } }),
  },
  codex_fork_intents: {
    harness: 'codex-cli', kind: 'fork-intent', keyColumn: 'source_session_id',
    toRow: ({ key, value }) => ({ source_session_id: key, target_message_id: value.targetMessageId,
      before_turn_id: value.beforeTurnId, created_at: value.createdAt }),
    toRecord: row => ({ harness: 'codex-cli', kind: 'fork-intent', key: String(row.source_session_id),
      sessionId: String(row.source_session_id), blocksSwitch: true,
      value: { targetMessageId: row.target_message_id, beforeTurnId: row.before_turn_id,
        createdAt: row.created_at ?? new Date().toISOString() } }),
  },
  codex_session_models: {
    harness: 'codex-cli', kind: 'model', keyColumn: 'session_id',
    toRow: ({ key, value }) => ({ session_id: key, model: value.model, effort: value.effort }),
    toRecord: row => ({ harness: 'codex-cli', kind: 'model', key: String(row.session_id), sessionId: String(row.session_id),
      blocksSwitch: false, value: { model: row.model, effort: row.effort } }),
  },
};

function mapping(table: string): TableMapping {
  const found = tables[table];
  if (!found) throw new Error(`No legacy native mapping for ${table}`);
  return found;
}

/** All rows of a former table, in insertion order. */
export function legacyRows<T extends Row = Row>(table: string): T[] {
  const { harness, kind, toRow } = mapping(table);
  return getDatabase().query<{ key: string; session_id: string; value: string }, [string, string]>(
    'SELECT key, session_id, value FROM harness_state WHERE harness = ? AND kind = ? ORDER BY rowid',
  ).all(harness, kind).map(row => toRow({ harness, kind, key: row.key, sessionId: row.session_id, blocksSwitch: false,
    value: JSON.parse(row.value) as Row }) as T);
}

/** The row with this key (session ID, source session ID or message ID), or null. */
export function legacyRow<T extends Row = Row>(table: string, key: string): T | null {
  const { keyColumn } = mapping(table);
  return legacyRows<T>(table).find(row => row[keyColumn] === key) ?? null;
}

/** The selected columns of a row, for assertions that projected columns. */
export function pick(row: Row | null | undefined, columns: string[]): Row | null {
  return row ? Object.fromEntries(columns.map(column => [column, row[column]])) : null;
}

/** Inserts a row as the former table would have; throws on a duplicate key or lookup. */
export function insertLegacyRow(table: string, row: Row): void {
  insertHarnessState(mapping(table).toRecord(row));
}

/** Updates columns of the row with this key; no-op when absent. */
export function updateLegacyRow(table: string, key: string, patch: Row): void {
  const current = legacyRow(table, key);
  if (current) putHarnessState(mapping(table).toRecord({ ...current, ...patch }));
}

/** Updates every row of a former table. */
export function updateLegacyRows(table: string, patch: Row): void {
  const { keyColumn } = mapping(table);
  for (const row of legacyRows(table)) updateLegacyRow(table, String(row[keyColumn]), patch);
}

export function deleteLegacyRow(table: string, key: string): void {
  const { harness, kind } = mapping(table);
  deleteHarnessState({ harness, kind, key });
}

/** Synchronous reads for assertions and `waitFor` predicates (the harness reads are async). */
export function codexBinding(sessionId: string): import('@prokopai/agent/internal/harnesses/codex-cli/bindings').CodexBinding | null {
  const record = getHarnessState<Row>({ harness: 'codex-cli', kind: 'binding', key: sessionId });
  if (!record) return null;
  const { createdAt: _createdAt, ...value } = record.value;
  return { sessionId, ...value } as unknown as import('@prokopai/agent/internal/harnesses/codex-cli/bindings').CodexBinding;
}

export function codexRollbackIntent(sessionId: string): import('@prokopai/agent/internal/harnesses/codex-cli/rollback').RollbackIntent | null {
  const record = getHarnessState<Row>({ harness: 'codex-cli', kind: 'rollback-intent', key: sessionId });
  return record ? { sessionId, ...record.value } as unknown as import('@prokopai/agent/internal/harnesses/codex-cli/rollback').RollbackIntent : null;
}
