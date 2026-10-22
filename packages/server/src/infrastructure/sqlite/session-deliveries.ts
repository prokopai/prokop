import type { Database } from 'bun:sqlite';
import type {
  SessionDeliveryRecord,
  SessionDeliveryRepositoryPort,
  SessionDeliveryState,
} from '@/application/sessions/delivery';

interface SessionDeliveryRow {
  delivery_key: string;
  session_id: string;
  origin: string;
  content: string;
  steer: number;
  state: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

function mapRow(row: SessionDeliveryRow): SessionDeliveryRecord {
  return {
    key: row.delivery_key,
    sessionId: row.session_id,
    origin: row.origin,
    content: row.content,
    steer: row.steer === 1,
    state: row.state as SessionDeliveryState,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

export function createSessionDeliveryRepository(getDatabase: () => Database): SessionDeliveryRepositoryPort {
  return {
    get(key) {
      const row = getDatabase().query('SELECT * FROM session_deliveries WHERE delivery_key = ?').get(key) as SessionDeliveryRow | null;
      return row ? mapRow(row) : null;
    },

    insert(record) {
      const result = getDatabase().run(
        `INSERT OR IGNORE INTO session_deliveries (
          delivery_key, session_id, origin, content, steer, state, attempts, last_error, created_at, delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.key,
          record.sessionId,
          record.origin,
          record.content,
          record.steer ? 1 : 0,
          record.state,
          record.attempts,
          record.lastError,
          record.createdAt,
          record.deliveredAt,
        ],
      );
      return result.changes > 0;
    },

    update(key, patch) {
      const set: string[] = [];
      const values: Array<string | number | null> = [];
      if (patch.state !== undefined) {
        set.push('state = ?');
        values.push(patch.state);
      }
      if (patch.attempts !== undefined) {
        set.push('attempts = ?');
        values.push(patch.attempts);
      }
      if (patch.lastError !== undefined) {
        set.push('last_error = ?');
        values.push(patch.lastError);
      }
      if (patch.deliveredAt !== undefined) {
        set.push('delivered_at = ?');
        values.push(patch.deliveredAt);
      }
      if (set.length === 0) return;
      values.push(key);
      getDatabase().run(`UPDATE session_deliveries SET ${set.join(', ')} WHERE delivery_key = ?`, values);
    },

    listPending(sessionId) {
      const rows = sessionId === undefined
        ? getDatabase().query("SELECT * FROM session_deliveries WHERE state = 'pending' ORDER BY created_at").all()
        : getDatabase().query("SELECT * FROM session_deliveries WHERE state = 'pending' AND session_id = ? ORDER BY created_at").all(sessionId);
      return (rows as SessionDeliveryRow[]).map(mapRow);
    },
  };
}
