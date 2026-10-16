import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createTerminalSessionRepository } from '@/infrastructure/sqlite/terminal-session-repository';

const repository = createTerminalSessionRepository(() => getDatabase());

describe('terminal-sessions store', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createTestTerminal(overrides: {
    id?: string;
    workspaceId?: string;
  } = {}) {
    repository.createTerminalSession({
      id: overrides.id ?? 'term-1',
      workspaceId: overrides.workspaceId ?? 'ws1',
      cwd: '/test',
      shell: '/bin/bash',
      pid: 12345,
      cols: 80,
      rows: 24,
      title: 'main',
    });
  }

  describe('createTerminalSession', () => {
    test('creates a terminal session', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal();

      const term = repository.getTerminalSession('term-1');
      expect(term).not.toBeNull();
      expect(term!.workspace_id).toBe('ws1');
      expect(term!.cwd).toBe('/test');
      expect(term!.shell).toBe('/bin/bash');
      expect(term!.pid).toBe(12345);
      expect(term!.status).toBe('running');
      expect(term!.title).toBe('main');
    });
  });

  describe('getTerminalSession', () => {
    test('returns null for non-existent', () => {
      expect(repository.getTerminalSession('nonexistent')).toBeNull();
    });
  });

  describe('updateTerminalSessionTitle', () => {
    test('updates the title', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal();

      repository.updateTerminalSessionTitle('term-1', 'custom title');
      const term = repository.getTerminalSession('term-1');
      expect(term!.title).toBe('custom title');
    });
  });

  describe('updateTerminalSessionActivity', () => {
    test('updates last_activity_at', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal();

      const beforeActivity = repository.getTerminalSession('term-1')!.last_activity_at;
      repository.updateTerminalSessionActivity('term-1');

      const afterActivity = repository.getTerminalSession('term-1')!.last_activity_at;
      expect(afterActivity).toBeGreaterThanOrEqual(beforeActivity);
    });
  });

  describe('markTerminalSessionExited', () => {
    test('marks session as exited with exit code', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal();

      repository.markTerminalSessionExited('term-1', 0);
      const term = repository.getTerminalSession('term-1');
      expect(term!.status).toBe('exited');
      expect(term!.exit_code).toBe(0);
    });

    test('marks session as exited with non-zero exit code', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal();

      repository.markTerminalSessionExited('term-1', 1);
      const term = repository.getTerminalSession('term-1');
      expect(term!.status).toBe('exited');
      expect(term!.exit_code).toBe(1);
    });
  });

  describe('markTerminalSessionDestroyed', () => {
    test('marks session as destroyed', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal();

      repository.markTerminalSessionDestroyed('term-1');
      const term = repository.getTerminalSession('term-1');
      expect(term!.status).toBe('destroyed');
      expect(term!.destroyed_at).toBeDefined();
    });
  });

  describe('listTerminalSessions', () => {
    test('returns all sessions for workspace', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal({ id: 'term-1' });
      createTestTerminal({ id: 'term-2' });

      const sessions = repository.listTerminalSessions('ws1');
      expect(sessions).toHaveLength(2);
    });

    test('returns empty for workspace with no terminals', () => {
      seedWorkspace({ id: 'ws1' });
      expect(repository.listTerminalSessions('ws1')).toHaveLength(0);
    });
  });

  describe('listActiveTerminalSessions', () => {
    test('returns running and exited sessions', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal({ id: 'term-1' });
      createTestTerminal({ id: 'term-2' });
      repository.markTerminalSessionDestroyed('term-2');

      const active = repository.listActiveTerminalSessions('ws1');
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('term-1');
    });
  });

  describe('cleanupStaleTerminalSessions', () => {
    test('removes destroyed sessions older than 1 hour', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal({ id: 'term-1' });
      repository.markTerminalSessionDestroyed('term-1');

      // The destroyed_at was set to Date.now(), so it shouldn't be cleaned up yet
      expect(repository.cleanupStaleTerminalSessions()).toBe(0);
    });
  });

  describe('cleanupRunningSessionsOnStartup', () => {
    test('marks all running sessions as destroyed', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal({ id: 'term-1' });
      createTestTerminal({ id: 'term-2' });

      const count = repository.cleanupRunningSessionsOnStartup();
      expect(count).toBe(2);

      expect(repository.getTerminalSession('term-1')!.status).toBe('destroyed');
      expect(repository.getTerminalSession('term-2')!.status).toBe('destroyed');
    });

    test('does not affect already exited sessions', () => {
      seedWorkspace({ id: 'ws1' });
      createTestTerminal({ id: 'term-1' });
      repository.markTerminalSessionExited('term-1', 0);

      const count = repository.cleanupRunningSessionsOnStartup();
      expect(count).toBe(0);

      const term = repository.getTerminalSession('term-1');
      expect(term!.status).toBe('exited');
    });
  });
});
