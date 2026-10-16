import type { Database } from 'bun:sqlite';
import type { NativeHarness, NativeKey, NativeRecord } from '@prokopai/core/infrastructure/storage/contracts';
import { getDatabase } from './database';

/**
 * Native harness state (host/agent split, plan F4 option A): Claude Code and
 * Codex bindings, rollback and fork intents, inherited user IDs and model
 * selections, one generic table. The host reads only `blocks_switch`, the
 * `binding` and `model` kinds and the cascades; `value` is harness-private
 * JSON. Writes are compare-and-set so they map onto `store.commit` checks.
 */

export type { NativeHarness } from '@prokopai/core/infrastructure/storage/contracts';
export type HarnessStateKey = NativeKey;
export type HarnessStateRecord<V = unknown> = NativeRecord<V>;

interface Row {
  harness: NativeHarness; kind: string; key: string; session_id: string; message_id: string | null;
  lookup: string | null; blocks_switch: number; value: string;
}

const MIGRATION_ID = 'native-tables-v1';

export function initializeHarnessStateSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS harness_state (
    harness TEXT NOT NULL CHECK (harness IN ('codex-cli', 'claude-cli')),
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    lookup TEXT,
    blocks_switch INTEGER NOT NULL DEFAULT 0,
    value TEXT NOT NULL,
    PRIMARY KEY (harness, kind, key)
  )`);
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_harness_state_lookup ON harness_state(harness, kind, lookup) WHERE lookup IS NOT NULL');
  db.run('CREATE INDEX IF NOT EXISTS idx_harness_state_session ON harness_state(session_id)');
  db.run(`CREATE TABLE IF NOT EXISTS harness_state_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  migrateNativeTables(db);
  for (const table of LEGACY_NATIVE_TABLES) db.run(`DROP TABLE IF EXISTS ${table}`);
}

/** The per-harness tables `harness_state` replaced; dropped at every start once copied. */
const LEGACY_NATIVE_TABLES = [
  'codex_session_bindings', 'codex_rollback_intents', 'codex_inherited_user_ids', 'codex_fork_intents', 'codex_session_models',
  'claude_session_bindings', 'claude_rollback_intents', 'claude_inherited_user_ids', 'claude_fork_intents', 'claude_session_models',
] as const;

/**
 * The legacy tables in their latest shape: creates missing ones and adds the
 * Codex binding columns older databases lack, so the copy below reads one
 * shape. Exported for the migration tests.
 */
export function createLegacyNativeTables(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS codex_session_bindings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL UNIQUE,
    cli_version TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    created_at TEXT NOT NULL,
    pending_turn INTEGER NOT NULL DEFAULT 0,
    pending_user_id TEXT,
    pending_assistant_id TEXT,
    pending_turn_id TEXT,
    goal_root_turn_id TEXT,
    goal_requested INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS codex_rollback_intents (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('edit', 'revert')),
    target_message_id TEXT NOT NULL,
    content TEXT,
    before_turn_id TEXT NOT NULL,
    turn_ids TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'rollback' CHECK (phase IN ('rollback', 'ready', 'sent'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS codex_inherited_user_ids (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    upstream_client_id TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS codex_fork_intents (
    source_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    target_message_id TEXT NOT NULL,
    before_turn_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  const bindingColumns = db.query<{ name: string }, []>('PRAGMA table_info(codex_session_bindings)').all();
  for (const [column, definition] of [
    ['pending_turn', 'INTEGER NOT NULL DEFAULT 0'],
    ['pending_user_id', 'TEXT'],
    ['pending_assistant_id', 'TEXT'],
    ['pending_turn_id', 'TEXT'],
    ['goal_root_turn_id', 'TEXT'],
    ['goal_requested', 'INTEGER NOT NULL DEFAULT 0'],
  ] as const) {
    if (!bindingColumns.some(entry => entry.name === column)) {
      db.run(`ALTER TABLE codex_session_bindings ADD COLUMN ${column} ${definition}`);
    }
  }

  db.run(`CREATE TABLE IF NOT EXISTS codex_session_models (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    effort TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS claude_session_models (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    effort TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS claude_session_bindings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    native_session_id TEXT NOT NULL UNIQUE,
    workspace_root TEXT NOT NULL,
    cli_version TEXT NOT NULL,
    pending INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS claude_rollback_intents (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('edit', 'revert')),
    target_message_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('fork', 'ready', 'sent'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS claude_inherited_user_ids (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    native_user_id TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS claude_fork_intents (
    source_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    target_message_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
}

/**
 * One-time copy of the ten legacy `claude_*`/`codex_*` tables. Idempotent:
 * a marker row prevents a second copy (which would resurrect state deleted
 * since). The legacy tables are dropped afterwards, so an older server on a
 * database migrated here starts with no Claude Code or Codex bindings.
 */
function migrateNativeTables(db: Database): void {
  if (db.query('SELECT 1 FROM harness_state_migrations WHERE id = ?').get(MIGRATION_ID)) return;
  createLegacyNativeTables(db);
  const bool = (column: string): string => `json(CASE WHEN ${column} THEN 'true' ELSE 'false' END)`;
  // Orphans can only exist if foreign keys were ever off; skip them rather than fail startup.
  const LIVE_SESSION = 'session_id IN (SELECT id FROM sessions)';
  const LIVE_SOURCE = 'source_session_id IN (SELECT id FROM sessions)';
  db.transaction(() => {
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, lookup, blocks_switch, value)
      SELECT 'codex-cli', 'binding', session_id, session_id, thread_id, pending_turn != 0, json_object(
        'threadId', thread_id, 'cliVersion', cli_version, 'workspaceRoot', workspace_root, 'createdAt', created_at,
        'pendingTurn', ${bool('pending_turn')}, 'pendingUserId', pending_user_id,
        'pendingAssistantId', pending_assistant_id, 'pendingTurnId', pending_turn_id,
        'goalRootTurnId', goal_root_turn_id, 'goalRequested', ${bool('goal_requested')})
      FROM codex_session_bindings WHERE ${LIVE_SESSION}`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, blocks_switch, value)
      SELECT 'codex-cli', 'rollback-intent', session_id, session_id, 1, json_object(
        'operation', operation, 'targetMessageId', target_message_id, 'content', content,
        'beforeTurnId', before_turn_id, 'turnIds', json(turn_ids), 'phase', phase)
      FROM codex_rollback_intents WHERE ${LIVE_SESSION}`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, blocks_switch, value)
      SELECT 'codex-cli', 'fork-intent', source_session_id, source_session_id, 1, json_object(
        'targetMessageId', target_message_id, 'beforeTurnId', before_turn_id, 'createdAt', created_at)
      FROM codex_fork_intents WHERE ${LIVE_SOURCE}`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, message_id, blocks_switch, value)
      SELECT 'codex-cli', 'inherited-user', i.message_id, m.session_id, i.message_id, 0,
        json_object('upstreamClientId', i.upstream_client_id)
      FROM codex_inherited_user_ids i JOIN messages m ON m.id = i.message_id`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, blocks_switch, value)
      SELECT 'codex-cli', 'model', session_id, session_id, 0, json_object('model', model, 'effort', effort)
      FROM codex_session_models WHERE ${LIVE_SESSION}`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, lookup, blocks_switch, value)
      SELECT 'claude-cli', 'binding', session_id, session_id, native_session_id, pending != 0, json_object(
        'nativeSessionId', native_session_id, 'workspaceRoot', workspace_root, 'cliVersion', cli_version,
        'pending', ${bool('pending')})
      FROM claude_session_bindings WHERE ${LIVE_SESSION}`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, blocks_switch, value)
      SELECT 'claude-cli', 'rollback-intent', session_id, session_id, 1, json_object(
        'operation', operation, 'targetMessageId', target_message_id, 'phase', phase)
      FROM claude_rollback_intents WHERE ${LIVE_SESSION}`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, blocks_switch, value)
      SELECT 'claude-cli', 'fork-intent', source_session_id, source_session_id, 1, json_object(
        'targetMessageId', target_message_id, 'createdAt', created_at)
      FROM claude_fork_intents WHERE ${LIVE_SOURCE}`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, message_id, blocks_switch, value)
      SELECT 'claude-cli', 'inherited-user', i.message_id, m.session_id, i.message_id, 0,
        json_object('nativeUserId', i.native_user_id)
      FROM claude_inherited_user_ids i JOIN messages m ON m.id = i.message_id`);
    db.run(`INSERT INTO harness_state (harness, kind, key, session_id, blocks_switch, value)
      SELECT 'claude-cli', 'model', session_id, session_id, 0, json_object('model', model, 'effort', effort)
      FROM claude_session_models WHERE ${LIVE_SESSION}`);
    db.run('INSERT INTO harness_state_migrations (id, applied_at) VALUES (?, ?)', [MIGRATION_ID, new Date().toISOString()]);
  })();
}

function toRecord<V>(row: Row | null): HarnessStateRecord<V> | null {
  return row ? {
    harness: row.harness, kind: row.kind, key: row.key, sessionId: row.session_id,
    messageId: row.message_id, lookup: row.lookup, blocksSwitch: row.blocks_switch !== 0,
    value: JSON.parse(row.value) as V,
  } : null;
}

export function getHarnessState<V>(target: HarnessStateKey): HarnessStateRecord<V> | null {
  return toRecord<V>(getDatabase().query<Row, [string, string, string]>(
    'SELECT * FROM harness_state WHERE harness = ? AND kind = ? AND key = ?',
  ).get(target.harness, target.kind, target.key));
}

export function findHarnessState<V>(harness: NativeHarness, kind: string, lookup: string): HarnessStateRecord<V> | null {
  return toRecord<V>(getDatabase().query<Row, [string, string, string]>(
    'SELECT * FROM harness_state WHERE harness = ? AND kind = ? AND lookup = ?',
  ).get(harness, kind, lookup));
}

/** Inserts a new record. Throws when the key or the lookup already exists. */
export function insertHarnessState(record: HarnessStateRecord): void {
  getDatabase().run(`INSERT INTO harness_state (harness, kind, key, session_id, message_id, lookup, blocks_switch, value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [record.harness, record.kind, record.key, record.sessionId,
    record.messageId ?? null, record.lookup ?? null, record.blocksSwitch ? 1 : 0, JSON.stringify(record.value)]);
}

/** Inserts or replaces a record. */
export function putHarnessState(record: HarnessStateRecord): void {
  getDatabase().run(`INSERT INTO harness_state (harness, kind, key, session_id, message_id, lookup, blocks_switch, value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(harness, kind, key) DO UPDATE SET session_id = excluded.session_id, message_id = excluded.message_id,
      lookup = excluded.lookup, blocks_switch = excluded.blocks_switch, value = excluded.value`,
  [record.harness, record.kind, record.key, record.sessionId, record.messageId ?? null, record.lookup ?? null,
    record.blocksSwitch ? 1 : 0, JSON.stringify(record.value)]);
}

export function deleteHarnessState(target: HarnessStateKey): boolean {
  return getDatabase().run('DELETE FROM harness_state WHERE harness = ? AND kind = ? AND key = ?',
    [target.harness, target.kind, target.key]).changes > 0;
}

/**
 * Reads, lets `change` decide, and writes in one transaction. `change`
 * returns the next record, `null` to delete, or `undefined` to leave it
 * (then the result is false). Across the agent protocol this becomes a
 * `store.commit` whose check is the value read here.
 */
export function updateHarnessState<V>(
  target: HarnessStateKey,
  change: (current: HarnessStateRecord<V> | null) => HarnessStateRecord<V> | null | undefined,
): boolean {
  return getDatabase().transaction(() => {
    const current = getHarnessState<V>(target);
    const next = change(current);
    if (next === undefined) return false;
    if (next === null) return current ? deleteHarnessState(target) : false;
    putHarnessState(next);
    return true;
  })();
}

/** A blocking record (pending turn, rollback or fork intent) exists for the session. */
export function hasBlockingHarnessState(sessionId: string): boolean {
  return !!getDatabase().query('SELECT 1 FROM harness_state WHERE session_id = ? AND blocks_switch = 1 LIMIT 1').get(sessionId);
}

/** The session is bound to a native Claude or Codex conversation. */
export function hasNativeBinding(sessionId: string): boolean {
  return !!getDatabase().query("SELECT 1 FROM harness_state WHERE session_id = ? AND kind = 'binding' LIMIT 1").get(sessionId);
}

/** Drops every native record of a session (harness switch detaches the old native thread). */
export function clearSessionHarnessState(sessionId: string, kinds?: string[]): void {
  if (!kinds) {
    getDatabase().run('DELETE FROM harness_state WHERE session_id = ?', [sessionId]);
    return;
  }
  for (const kind of kinds) getDatabase().run('DELETE FROM harness_state WHERE session_id = ? AND kind = ?', [sessionId, kind]);
}
