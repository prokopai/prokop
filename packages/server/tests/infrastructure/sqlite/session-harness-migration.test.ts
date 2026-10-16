import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { initializeSchema } from '@/infrastructure/sqlite/database';
import { initializeSessionMessageSchema } from '@/infrastructure/sqlite/session-message-schema';
import { createSessionRepository } from '@/infrastructure/sqlite/session-repository';
import { widenSessionHarnessConstraint } from '@/infrastructure/sqlite/claude-harness-migration';

test('widens an existing harness CHECK without losing child rows, indexes or FK enforcement', () => {
  const db = new Database(':memory:');
  try {
    db.run('PRAGMA foreign_keys = ON');
    db.run(`CREATE TABLE sessions (id TEXT PRIMARY KEY, harness TEXT NOT NULL DEFAULT 'prokop'
      CHECK (harness IN ('prokop', 'codex-cli')))`);
    db.run('CREATE INDEX idx_sessions_harness_test ON sessions(harness)');
    db.run('CREATE TABLE children (id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE)');
    db.run("INSERT INTO sessions (id, harness) VALUES ('old', 'codex-cli')");
    db.run("INSERT INTO children (id, session_id) VALUES ('child', 'old')");
    widenSessionHarnessConstraint(db);
    widenSessionHarnessConstraint(db);
    db.run("INSERT INTO sessions (id, harness) VALUES ('new', 'claude-cli')");
    expect(db.query('SELECT * FROM children').all()).toEqual([{ id: 'child', session_id: 'old' }]);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => db.run("INSERT INTO sessions (id, harness) VALUES ('bad', 'unknown')")).toThrow();
    db.run("DELETE FROM sessions WHERE id = 'old'");
    expect(db.query('SELECT * FROM children').all()).toEqual([]);
  } finally { db.close(); }
});

test('existing session rows acquire the Prokop harness without replacing their data', () => {
  const db = new Database(':memory:');
  try {
    initializeSchema(db);
    db.run('ALTER TABLE sessions DROP COLUMN harness');
    db.run(`INSERT INTO sessions (id, workspace_id, title, status, created_at, updated_at)
      VALUES ('legacy', 'workspace', 'Original title', 'active', '2024-01-01', '2024-01-02')`);

    initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });
    initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });

    const repo = createSessionRepository(() => db, {
      events: { publish: () => {} },
      deleteAttachmentsForSession: () => {},
      deleteAttachmentsForWorkspace: () => {},
      cleanupSessionOutputDir: () => {},
    });
    expect(repo.getSession('legacy')).toMatchObject({
      title: 'Original title', updatedAt: '2024-01-02', harness: 'prokop',
    });
    const column = db.query<{ name: string }, []>('PRAGMA table_info(sessions)')
      .all().filter(row => row.name === 'harness');
    expect(column).toHaveLength(1);
  } finally {
    db.close();
  }
});

test('Codex bindings from before the recovery columns migrate with their thread', () => {
  const db = new Database(':memory:');
  try {
    initializeSchema(db);
    // A database from before harness_state, whose binding table predates the recovery columns.
    db.run('DELETE FROM harness_state_migrations');
    db.run(`CREATE TABLE codex_session_bindings (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL UNIQUE, cli_version TEXT NOT NULL, workspace_root TEXT NOT NULL, created_at TEXT NOT NULL)`);
    db.run("INSERT INTO sessions (id, workspace_id, harness, status, created_at, updated_at) VALUES ('s', 'w', 'codex-cli', 'active', 'now', 'now')");
    db.run("INSERT INTO codex_session_bindings (session_id, thread_id, cli_version, workspace_root, created_at) VALUES ('s', 't', 'codex-cli 0.156.1', '/tmp', 'now')");
    initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });
    initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });
    const row = db.query<{ value: string }, []>(
      "SELECT value FROM harness_state WHERE harness = 'codex-cli' AND kind = 'binding' AND key = 's'",
    ).get();
    expect(JSON.parse(row!.value)).toEqual({ threadId: 't', cliVersion: 'codex-cli 0.156.1', workspaceRoot: '/tmp',
      createdAt: 'now', pendingTurn: false, pendingUserId: null, pendingAssistantId: null, pendingTurnId: null,
      goalRootTurnId: null, goalRequested: false });
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name = 'codex_session_bindings'").get()).toBeNull();
  } finally {
    db.close();
  }
});
