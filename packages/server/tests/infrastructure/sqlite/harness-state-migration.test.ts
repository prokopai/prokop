import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { getDatabase } from '@/infrastructure/sqlite/database';
import {
  createLegacyNativeTables, deleteHarnessState, getHarnessState, hasBlockingHarnessState, hasNativeBinding,
  initializeHarnessStateSchema,
} from '@/infrastructure/sqlite/harness-state';
import { createMessage } from '@/infrastructure/sqlite/message-store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

const legacyTableCount = (db: Database): number => db.query<{ n: number }, []>(
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND (name GLOB 'claude_*' OR name GLOB 'codex_*')",
).get()!.n;

/** Restores the pre-migration state: legacy rows present, no harness_state, no marker. */
function seedLegacyTables(db: Database): void {
  db.run('DELETE FROM harness_state');
  db.run('DELETE FROM harness_state_migrations');
  createLegacyNativeTables(db);
  seedWorkspace();
  seedSession('ws1', { id: 'codex', harness: 'codex-cli' });
  seedSession('ws1', { id: 'claude', harness: 'claude-cli' });
  createMessage({ id: 'codex-user', sessionId: 'codex', role: 'user', createdAt: 1 });
  createMessage({ id: 'claude-user', sessionId: 'claude', role: 'user', createdAt: 1 });
  db.run(`INSERT INTO codex_session_bindings (session_id, thread_id, cli_version, workspace_root, created_at,
    pending_turn, pending_user_id, pending_assistant_id, pending_turn_id, goal_root_turn_id, goal_requested)
    VALUES ('codex', 'thread-1', '0.156.1', '/w', '2026-01-01', 1, 'codex-user', 'a1', 'turn-1', NULL, 0)`);
  db.run(`INSERT INTO codex_rollback_intents (session_id, operation, target_message_id, content, before_turn_id, turn_ids, phase)
    VALUES ('codex', 'edit', 'codex-user', 'new text', 'turn-0', '["turn-1","turn-2"]', 'ready')`);
  db.run(`INSERT INTO codex_inherited_user_ids (message_id, upstream_client_id) VALUES ('codex-user', 'up-1')`);
  db.run(`INSERT INTO codex_session_models (session_id, model, effort) VALUES ('codex', 'gpt-5', 'high')`);
  db.run(`INSERT INTO claude_session_bindings (session_id, native_session_id, workspace_root, cli_version, pending)
    VALUES ('claude', 'native-1', '/w', '2.1.274', 0)`);
  db.run(`INSERT INTO claude_fork_intents (source_session_id, target_message_id, created_at)
    VALUES ('claude', 'claude-user', '2026-01-02')`);
  db.run(`INSERT INTO claude_inherited_user_ids (message_id, native_user_id) VALUES ('claude-user', 'native-user-1')`);
  db.run(`INSERT INTO claude_session_models (session_id, model, effort) VALUES ('claude', 'sonnet', 'medium')`);
}

describe('harness_state migration from the legacy native tables', () => {
  beforeEach(() => {
    setupTestDatabase();
  });
  afterEach(() => resetTestDatabase());

  test('a fresh database has no legacy tables', () => {
    expect(legacyTableCount(getDatabase())).toBe(0);
  });

  test('copies every legacy record with its key, cascades, lookup and switch flag', () => {
    const db = getDatabase();
    seedLegacyTables(db);
    initializeHarnessStateSchema(db);

    expect(getHarnessState({ harness: 'codex-cli', kind: 'binding', key: 'codex' })).toEqual({
      harness: 'codex-cli', kind: 'binding', key: 'codex', sessionId: 'codex', messageId: null, lookup: 'thread-1',
      blocksSwitch: true, value: {
        threadId: 'thread-1', cliVersion: '0.156.1', workspaceRoot: '/w', createdAt: '2026-01-01',
        pendingTurn: true, pendingUserId: 'codex-user', pendingAssistantId: 'a1', pendingTurnId: 'turn-1',
        goalRootTurnId: null, goalRequested: false,
      },
    });
    expect(getHarnessState({ harness: 'codex-cli', kind: 'rollback-intent', key: 'codex' })?.value).toEqual({
      operation: 'edit', targetMessageId: 'codex-user', content: 'new text', beforeTurnId: 'turn-0',
      turnIds: ['turn-1', 'turn-2'], phase: 'ready',
    });
    expect(getHarnessState({ harness: 'codex-cli', kind: 'inherited-user', key: 'codex-user' })).toMatchObject({
      sessionId: 'codex', messageId: 'codex-user', blocksSwitch: false, value: { upstreamClientId: 'up-1' },
    });
    expect(getHarnessState({ harness: 'codex-cli', kind: 'model', key: 'codex' })?.value).toEqual({ model: 'gpt-5', effort: 'high' });
    expect(getHarnessState({ harness: 'claude-cli', kind: 'binding', key: 'claude' })).toMatchObject({
      lookup: 'native-1', blocksSwitch: false,
      value: { nativeSessionId: 'native-1', workspaceRoot: '/w', cliVersion: '2.1.274', pending: false },
    });
    expect(getHarnessState({ harness: 'claude-cli', kind: 'fork-intent', key: 'claude' })).toMatchObject({
      blocksSwitch: true, value: { targetMessageId: 'claude-user', createdAt: '2026-01-02' },
    });
    expect(getHarnessState({ harness: 'claude-cli', kind: 'inherited-user', key: 'claude-user' })?.value)
      .toEqual({ nativeUserId: 'native-user-1' });
    expect(getHarnessState({ harness: 'claude-cli', kind: 'model', key: 'claude' })?.value).toEqual({ model: 'sonnet', effort: 'medium' });

    // Host checks read only the generic flags.
    expect(hasBlockingHarnessState('codex')).toBe(true);
    expect(hasBlockingHarnessState('claude')).toBe(true);
    expect(hasNativeBinding('claude')).toBe(true);
  });

  test('runs once and drops the legacy tables: a second start neither duplicates nor resurrects deleted state', () => {
    const db = getDatabase();
    seedLegacyTables(db);
    initializeHarnessStateSchema(db);
    expect(legacyTableCount(db)).toBe(0);
    const count = (): number => db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM harness_state').get()!.n;
    expect(count()).toBe(8);

    deleteHarnessState({ harness: 'claude-cli', kind: 'fork-intent', key: 'claude' });
    initializeHarnessStateSchema(db);
    expect(count()).toBe(7);
    expect(getHarnessState({ harness: 'claude-cli', kind: 'fork-intent', key: 'claude' })).toBeNull();
    expect(legacyTableCount(db)).toBe(0);
  });

  test('orphaned legacy rows (written while foreign keys were off) are skipped, not fatal', () => {
    const db = getDatabase();
    seedLegacyTables(db);
    db.run('PRAGMA foreign_keys = OFF');
    db.run(`INSERT INTO codex_session_bindings (session_id, thread_id, cli_version, workspace_root, created_at,
      pending_turn, goal_requested) VALUES ('gone', 'thread-gone', '0.156.1', '/w', '2026-01-01', 0, 0)`);
    db.run(`INSERT INTO claude_fork_intents (source_session_id, target_message_id, created_at)
      VALUES ('gone', 'm', '2026-01-02')`);
    db.run('PRAGMA foreign_keys = ON');
    initializeHarnessStateSchema(db);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM harness_state').get()!.n).toBe(8);
    expect(db.query("SELECT 1 FROM harness_state WHERE session_id = 'gone'").get()).toBeNull();
  });

  test('records go with their session and message', () => {
    const db = getDatabase();
    seedLegacyTables(db);
    initializeHarnessStateSchema(db);
    db.run("DELETE FROM messages WHERE id = 'claude-user'");
    expect(getHarnessState({ harness: 'claude-cli', kind: 'inherited-user', key: 'claude-user' })).toBeNull();
    db.run("DELETE FROM sessions WHERE id = 'codex'");
    expect(db.query("SELECT 1 FROM harness_state WHERE session_id = 'codex'").get()).toBeNull();
  });
});
