import { afterAll, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createRuntime } from '@/bootstrap/create-runtime';
import { initializeSchema, DB } from '@/infrastructure/sqlite/database';

/**
 * Create a fresh in-memory SQLite database with full schema initialized.
 * Each call returns a new, isolated DB — no cross-test contamination.
 *
 * Usage:
 *   const db = createTestDatabase();
 *   // ... use store functions that call getDatabase() ...
 *   db.close();
 */
export function createTestDatabase(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  initializeSchema(db);
  return db;
}

/**
 * Set up an in-memory database as the active store singleton.
 * Call this in beforeEach(). Call resetTestDatabase() in afterEach().
 *
 * Usage:
 *   beforeEach(() => setupTestDatabase());
 *   afterEach(() => resetTestDatabase());
 */
export function setupTestDatabase(): Database {
  createRuntime();
  const db = createTestDatabase();
  DB.configure({ database: db });
  return db;
}

/**
 * For test files that drive harness code in the test process (memory and
 * skill tools, compaction, composition): run them with in-process harnesses
 * even when the whole suite started with PROKOPAI_AGENT_PROCESS=1, whose lean
 * host configures no in-process runtime. Call once at the top of the file.
 */
export function pinInProcessHarnesses(): void {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.PROKOPAI_AGENT_PROCESS;
    delete process.env.PROKOPAI_AGENT_PROCESS;
  });
  afterAll(() => {
    if (saved !== undefined) process.env.PROKOPAI_AGENT_PROCESS = saved;
  });
}

/**
 * After a test that switched the agent ports (PROKOPAI_AGENT_LOOPBACK=1):
 * rebuild every port for the configured mode, not only storage and the
 * runtime host, so no protocol-backed port leaks into later test files.
 * Restore the env flags first.
 */
export function restoreConfiguredRuntime(): void {
  createRuntime();
}

/**
 * Tear down the test database override.
 * Call this in afterEach() to prevent leaks.
 */
export function resetTestDatabase(): void {
  DB.reset();
}
