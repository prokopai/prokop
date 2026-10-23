import type { Database } from 'bun:sqlite';
import type { AgentConversationRecord, AgentConversationStore } from '@prokopai/core/application/ports/agent-messaging';

interface Row {
  id: string;
  sender_session_id: string;
  sender_agent_id: string | null;
  recipient_agent_id: string;
  recipient_session_id: string;
  explicit_result_wake_id: string | null;
  created_at: string;
}

function mapRow(row: Row): AgentConversationRecord {
  return {
    id: row.id,
    senderSessionId: row.sender_session_id,
    senderAgentId: row.sender_agent_id,
    recipientAgentId: row.recipient_agent_id,
    recipientSessionId: row.recipient_session_id,
    explicitResultWakeId: row.explicit_result_wake_id,
    createdAt: row.created_at,
  };
}

export function createAgentConversationStore(getDatabase: () => Database): AgentConversationStore {
  return {
    get(id) {
      const row = getDatabase().query('SELECT * FROM agent_conversations WHERE id = ?').get(id) as Row | null;
      return row ? mapRow(row) : null;
    },
    findBySender(senderSessionId, recipientAgentId) {
      const row = getDatabase().query(
        'SELECT * FROM agent_conversations WHERE sender_session_id = ? AND recipient_agent_id = ?',
      ).get(senderSessionId, recipientAgentId) as Row | null;
      return row ? mapRow(row) : null;
    },
    findByRecipientSession(recipientSessionId) {
      const row = getDatabase().query(
        'SELECT * FROM agent_conversations WHERE recipient_session_id = ?',
      ).get(recipientSessionId) as Row | null;
      return row ? mapRow(row) : null;
    },
    listBySender(senderSessionId) {
      return (getDatabase().query(
        'SELECT * FROM agent_conversations WHERE sender_session_id = ? ORDER BY created_at',
      ).all(senderSessionId) as Row[]).map(mapRow);
    },
    upsert(record) {
      getDatabase().run(
        `INSERT INTO agent_conversations (
          id, sender_session_id, sender_agent_id, recipient_agent_id, recipient_session_id, explicit_result_wake_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          sender_agent_id = excluded.sender_agent_id,
          recipient_session_id = excluded.recipient_session_id,
          explicit_result_wake_id = excluded.explicit_result_wake_id`,
        [record.id, record.senderSessionId, record.senderAgentId, record.recipientAgentId, record.recipientSessionId,
          record.explicitResultWakeId, record.createdAt],
      );
    },
    delete(id) {
      getDatabase().run('DELETE FROM agent_conversations WHERE id = ?', [id]);
    },
  };
}
