import type { Database } from 'bun:sqlite';
import type { AgentGroupMessage, Part } from '@prokopai/sdk';
import type {
  AgentGroupMemberRecord,
  AgentGroupMessageQuery,
  AgentGroupMessageRange,
  AgentGroupRecord,
  AgentGroupStore,
} from '@prokopai/core/application/ports/agent-groups';

interface GroupRow {
  id: string;
  workspace_id: string;
  name: string;
  default_agent_id: string;
  permission_mode: string;
  membership_version: number;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  group_id: string;
  agent_id: string;
  member_session_id: string;
  cursor_seq: number;
  roster_version: number;
  joined_at: string;
}

interface MessageRow {
  id: string;
  group_id: string;
  seq: number;
  author_kind: string;
  author_agent_id: string | null;
  target_agent_id: string | null;
  source_message_id: string | null;
  parts: string;
  hop: number;
  created_at: string;
}

function mapGroup(row: GroupRow): AgentGroupRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    defaultAgentId: row.default_agent_id,
    permissionMode: row.permission_mode as AgentGroupRecord['permissionMode'],
    membershipVersion: row.membership_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: MemberRow): AgentGroupMemberRecord {
  return {
    groupId: row.group_id,
    agentId: row.agent_id,
    memberSessionId: row.member_session_id,
    cursorSeq: row.cursor_seq,
    rosterVersion: row.roster_version,
    joinedAt: row.joined_at,
  };
}

function mapMessage(row: MessageRow): AgentGroupMessage {
  let parts: Part[] = [];
  try {
    const parsed: unknown = JSON.parse(row.parts);
    if (Array.isArray(parsed)) parts = parsed as Part[];
  } catch {
    // A malformed row reads as an empty message rather than failing the whole list.
  }
  return {
    id: row.id,
    groupId: row.group_id,
    seq: row.seq,
    authorKind: row.author_kind as AgentGroupMessage['authorKind'],
    authorAgentId: row.author_agent_id,
    targetAgentId: row.target_agent_id,
    sourceMessageId: row.source_message_id,
    parts,
    hop: row.hop,
    createdAt: row.created_at,
  };
}

/** The WHERE clauses and parameters for a message range. */
function rangeSql(groupId: string, range: AgentGroupMessageRange): { where: string; params: (string | number)[] } {
  const clauses = ['group_id = ?'];
  const params: (string | number)[] = [groupId];
  if (range.afterSeq !== undefined) { clauses.push('seq > ?'); params.push(range.afterSeq); }
  if (range.beforeSeq !== undefined) { clauses.push('seq < ?'); params.push(range.beforeSeq); }
  if (range.excludeAuthorAgentId !== undefined) { clauses.push('(author_agent_id IS NULL OR author_agent_id != ?)'); params.push(range.excludeAuthorAgentId); }
  return { where: clauses.join(' AND '), params };
}

export function createAgentGroupStore(getDatabase: () => Database): AgentGroupStore {
  return {
    getGroup(id) {
      const row = getDatabase().query('SELECT * FROM agent_groups WHERE id = ?').get(id) as GroupRow | null;
      return row ? mapGroup(row) : null;
    },
    listGroups(workspaceId) {
      return (getDatabase().query('SELECT * FROM agent_groups WHERE workspace_id = ? ORDER BY created_at, id').all(workspaceId) as GroupRow[]).map(mapGroup);
    },
    insertGroup(record) {
      getDatabase().run(
        `INSERT INTO agent_groups (id, workspace_id, name, default_agent_id, permission_mode, membership_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.workspaceId, record.name, record.defaultAgentId, record.permissionMode, record.membershipVersion, record.createdAt, record.updatedAt],
      );
    },
    updateGroup(id, patch) {
      const sets: string[] = [];
      const params: (string | number)[] = [];
      if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
      if (patch.defaultAgentId !== undefined) { sets.push('default_agent_id = ?'); params.push(patch.defaultAgentId); }
      if (patch.permissionMode !== undefined) { sets.push('permission_mode = ?'); params.push(patch.permissionMode); }
      if (patch.membershipVersion !== undefined) { sets.push('membership_version = ?'); params.push(patch.membershipVersion); }
      if (patch.updatedAt !== undefined) { sets.push('updated_at = ?'); params.push(patch.updatedAt); }
      if (sets.length === 0) return;
      params.push(id);
      getDatabase().run(`UPDATE agent_groups SET ${sets.join(', ')} WHERE id = ?`, params);
    },
    deleteGroup(id) {
      // Members and messages reference the group with ON DELETE CASCADE.
      getDatabase().run('DELETE FROM agent_groups WHERE id = ?', [id]);
    },

    listMembers(groupId) {
      return (getDatabase().query('SELECT * FROM agent_group_members WHERE group_id = ? ORDER BY joined_at, agent_id').all(groupId) as MemberRow[]).map(mapMember);
    },
    findMemberBySession(sessionId) {
      const row = getDatabase().query('SELECT * FROM agent_group_members WHERE member_session_id = ?').get(sessionId) as MemberRow | null;
      return row ? mapMember(row) : null;
    },
    upsertMember(record) {
      getDatabase().run(
        `INSERT INTO agent_group_members (group_id, agent_id, member_session_id, cursor_seq, roster_version, joined_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(group_id, agent_id) DO UPDATE SET
           member_session_id = excluded.member_session_id,
           cursor_seq = excluded.cursor_seq,
           roster_version = excluded.roster_version`,
        [record.groupId, record.agentId, record.memberSessionId, record.cursorSeq, record.rosterVersion, record.joinedAt],
      );
    },
    updateMember(groupId, agentId, patch) {
      const sets: string[] = [];
      const params: (string | number)[] = [];
      if (patch.cursorSeq !== undefined) { sets.push('cursor_seq = ?'); params.push(patch.cursorSeq); }
      if (patch.rosterVersion !== undefined) { sets.push('roster_version = ?'); params.push(patch.rosterVersion); }
      if (patch.memberSessionId !== undefined) { sets.push('member_session_id = ?'); params.push(patch.memberSessionId); }
      if (sets.length === 0) return;
      params.push(groupId, agentId);
      getDatabase().run(`UPDATE agent_group_members SET ${sets.join(', ')} WHERE group_id = ? AND agent_id = ?`, params);
    },
    deleteMember(groupId, agentId) {
      getDatabase().run('DELETE FROM agent_group_members WHERE group_id = ? AND agent_id = ?', [groupId, agentId]);
    },

    appendMessage(message) {
      const db = getDatabase();
      return db.transaction(() => {
        const seq = ((db.query('SELECT COALESCE(MAX(seq), 0) AS seq FROM agent_group_messages WHERE group_id = ?').get(message.groupId) as { seq: number }).seq) + 1;
        db.run(
          `INSERT INTO agent_group_messages (id, group_id, seq, author_kind, author_agent_id, target_agent_id, source_message_id, parts, hop, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [message.id, message.groupId, seq, message.authorKind, message.authorAgentId, message.targetAgentId, message.sourceMessageId,
            JSON.stringify(message.parts), message.hop, message.createdAt],
        );
        return { ...message, seq };
      })();
    },
    listMessages(groupId, query: AgentGroupMessageQuery) {
      const { where, params } = rangeSql(groupId, query);
      const order = query.take === 'oldest' ? 'ASC' : 'DESC';
      const rows = getDatabase().query(`SELECT * FROM agent_group_messages WHERE ${where} ORDER BY seq ${order} LIMIT ?`)
        .all(...params, query.limit) as MessageRow[];
      const messages = rows.map(mapMessage);
      return query.take === 'oldest' ? messages : messages.reverse();
    },
    countMessages(groupId, range) {
      const { where, params } = rangeSql(groupId, range);
      return (getDatabase().query(`SELECT COUNT(*) AS count FROM agent_group_messages WHERE ${where}`).get(...params) as { count: number }).count;
    },
    latestSeq(groupId) {
      return (getDatabase().query('SELECT COALESCE(MAX(seq), 0) AS seq FROM agent_group_messages WHERE group_id = ?').get(groupId) as { seq: number }).seq;
    },
    hasSourceMessage(groupId, sourceMessageId) {
      return getDatabase().query("SELECT 1 FROM agent_group_messages WHERE group_id = ? AND source_message_id = ? AND author_kind = 'agent' LIMIT 1").get(groupId, sourceMessageId) !== null;
    },
  };
}
