import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createDelegatedTaskStore } from '@/infrastructure/sqlite/delegated-tasks';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { deleteSession } from '@/infrastructure/sqlite/session-store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspaceWithSession } from '#tests/seed';

beforeEach(() => setupTestDatabase());
afterEach(() => resetTestDatabase());

test('delegated task rows round-trip, dedupe by request key, list undelivered work and go with the child', () => {
  const { sessionId: parent } = seedWorkspaceWithSession();
  const child = seedSession('ws1', { id: 'child-1', parentId: parent });
  const other = seedSession('ws1', { id: 'child-2', parentId: parent });
  const store = createDelegatedTaskStore(getDatabase);

  store.upsert({ taskId: child.id, parentSessionId: parent, kind: 'child', worktreeId: null, branch: null, requestKey: 'r1', description: 'Review', harness: 'codex-cli', model: 'gpt-5.5',
    serial: 1, watched: false, settled: false, deliveredSerial: 0, createdAt: 't0', updatedAt: 't0' });
  expect(store.get(child.id)).toMatchObject({ requestKey: 'r1', harness: 'codex-cli', watched: false, settled: false });
  expect(store.findByRequest(parent, 'r1')?.taskId).toBe(child.id);
  expect(store.findByRequest(parent, 'r2')).toBeNull();
  expect(store.findByRequest('someone-else', 'r1')).toBeNull();

  // A second child cannot claim the same request key under the same parent.
  expect(() => store.upsert({ taskId: other.id, parentSessionId: parent, kind: 'child', worktreeId: null, branch: null, requestKey: 'r1', description: 'Dup', harness: 'prokop', model: null,
    serial: 1, watched: false, settled: false, deliveredSerial: 0, createdAt: 't0', updatedAt: 't0' })).toThrow();
  // Rows without a request key are unlimited.
  store.upsert({ taskId: other.id, parentSessionId: parent, kind: 'launch', worktreeId: 'wt-1', branch: 'feature/free', requestKey: null, description: 'Free', harness: 'prokop', model: null,
    serial: 1, watched: true, settled: true, deliveredSerial: 0, createdAt: 't0', updatedAt: 't1' });

  store.upsert({ ...store.get(child.id)!, serial: 2, watched: true, settled: true, deliveredSerial: 1, updatedAt: 't2' });
  expect(store.listUndelivered().map((row) => row.taskId)).toEqual([other.id, child.id]);
  store.upsert({ ...store.get(child.id)!, deliveredSerial: 2 });
  expect(store.listUndelivered().map((row) => row.taskId)).toEqual([other.id]);

  expect(store.listByParent(parent).map((row) => [row.taskId, row.kind, row.branch])).toEqual([[child.id, 'child', null], [other.id, 'launch', 'feature/free']]);
  expect(store.listByParent('nobody')).toEqual([]);

  deleteSession(other.id);
  expect(store.get(other.id)).toBeNull();
  expect(store.listUndelivered()).toEqual([]);
});
