import type { Database } from 'bun:sqlite';
import type { SessionHarness } from '@prokopai/sdk';
import type { DelegatedTaskRecord, DelegatedTaskStore } from '@prokopai/core/application/ports/delegation-host';

interface Row {
  task_id: string;
  parent_session_id: string;
  request_key: string | null;
  description: string;
  harness: string;
  model: string | null;
  serial: number;
  watched: number;
  settled: number;
  delivered_serial: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: Row): DelegatedTaskRecord {
  return {
    taskId: row.task_id,
    parentSessionId: row.parent_session_id,
    requestKey: row.request_key,
    description: row.description,
    harness: row.harness as SessionHarness,
    model: row.model,
    serial: row.serial,
    watched: row.watched === 1,
    settled: row.settled === 1,
    deliveredSerial: row.delivered_serial,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDelegatedTaskStore(getDatabase: () => Database): DelegatedTaskStore {
  return {
    get(taskId) {
      const row = getDatabase().query('SELECT * FROM delegated_tasks WHERE task_id = ?').get(taskId) as Row | null;
      return row ? mapRow(row) : null;
    },
    findByRequest(parentSessionId, requestKey) {
      const row = getDatabase().query(
        'SELECT * FROM delegated_tasks WHERE parent_session_id = ? AND request_key = ?',
      ).get(parentSessionId, requestKey) as Row | null;
      return row ? mapRow(row) : null;
    },
    upsert(record) {
      getDatabase().run(
        `INSERT INTO delegated_tasks (
          task_id, parent_session_id, request_key, description, harness, model, serial, watched, settled, delivered_serial, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          request_key = excluded.request_key,
          description = excluded.description,
          harness = excluded.harness,
          model = excluded.model,
          serial = excluded.serial,
          watched = excluded.watched,
          settled = excluded.settled,
          delivered_serial = excluded.delivered_serial,
          updated_at = excluded.updated_at`,
        [
          record.taskId, record.parentSessionId, record.requestKey, record.description, record.harness, record.model,
          record.serial, record.watched ? 1 : 0, record.settled ? 1 : 0, record.deliveredSerial, record.createdAt, record.updatedAt,
        ],
      );
    },
    listUndelivered() {
      return (getDatabase().query(
        'SELECT * FROM delegated_tasks WHERE watched = 1 AND settled = 1 AND delivered_serial < serial ORDER BY updated_at',
      ).all() as Row[]).map(mapRow);
    },
  };
}
