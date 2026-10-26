import type { AgentGroupMessage, PermissionMode } from '@prokopai/sdk';
import type { AgentGroupsService } from '../groups/service';

/**
 * Storage for group chats (docs/plans/agent-group-chat.md) and the one
 * installed service instance. The server builds the service over SQLite and
 * installs it; the model-facing tools (`group_history`, `handoff_to_agent`)
 * reach the same instance through `agentGroups()`. Without one installed no
 * session is a member of anything and the tools are not listed.
 */

export interface AgentGroupRecord {
  id: string;
  workspaceId: string;
  name: string;
  defaultAgentId: string;
  /** What every member session runs with. */
  permissionMode: PermissionMode;
  /** Bumped on every join or leave; a member whose roster version is behind gets the roster again. */
  membershipVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentGroupMemberRecord {
  groupId: string;
  agentId: string;
  memberSessionId: string;
  /** The newest group message this member has received. */
  cursorSeq: number;
  /** The membership version whose roster this member has seen; 0 before the first wake. */
  rosterVersion: number;
  joinedAt: string;
}

export interface AgentGroupMessageRange {
  /** Exclusive lower bound. */
  afterSeq?: number;
  /** Exclusive upper bound. */
  beforeSeq?: number;
  /** Leave out this member's own messages. */
  excludeAuthorAgentId?: string;
}

export interface AgentGroupMessageQuery extends AgentGroupMessageRange {
  limit: number;
  /** Which end of the range the `limit` keeps; default `newest`. Results are oldest first either way. */
  take?: 'newest' | 'oldest';
}

export interface AgentGroupStore {
  getGroup(id: string): AgentGroupRecord | null;
  listGroups(workspaceId: string): AgentGroupRecord[];
  insertGroup(record: AgentGroupRecord): void;
  updateGroup(id: string, patch: Partial<Pick<AgentGroupRecord, 'name' | 'defaultAgentId' | 'permissionMode' | 'membershipVersion' | 'updatedAt'>>): void;
  deleteGroup(id: string): void;

  listMembers(groupId: string): AgentGroupMemberRecord[];
  findMemberBySession(sessionId: string): AgentGroupMemberRecord | null;
  upsertMember(record: AgentGroupMemberRecord): void;
  updateMember(groupId: string, agentId: string, patch: Partial<Pick<AgentGroupMemberRecord, 'cursorSeq' | 'rosterVersion' | 'memberSessionId'>>): void;
  deleteMember(groupId: string, agentId: string): void;

  /** Assigns the next seq in the group. */
  appendMessage(message: Omit<AgentGroupMessage, 'seq'>): AgentGroupMessage;
  listMessages(groupId: string, query: AgentGroupMessageQuery): AgentGroupMessage[];
  countMessages(groupId: string, range: AgentGroupMessageRange): number;
  latestSeq(groupId: string): number;
  /** Whether a member session message was already copied into the group as a reply (a handoff naming it as its source does not count). */
  hasSourceMessage(groupId: string, sourceMessageId: string): boolean;
}

/** An in-memory store for tests and hosts without persistence. */
export function createMemoryAgentGroupStore(): AgentGroupStore {
  const groups = new Map<string, AgentGroupRecord>();
  const members = new Map<string, AgentGroupMemberRecord>();
  const messages = new Map<string, AgentGroupMessage[]>();
  const memberKey = (groupId: string, agentId: string) => `${groupId}\u0000${agentId}`;
  const inRange = (range: AgentGroupMessageRange) => (message: AgentGroupMessage) =>
    (range.afterSeq === undefined || message.seq > range.afterSeq)
    && (range.beforeSeq === undefined || message.seq < range.beforeSeq)
    && (range.excludeAuthorAgentId === undefined || message.authorAgentId !== range.excludeAuthorAgentId);
  return {
    getGroup: (id) => groups.get(id) ?? null,
    listGroups: (workspaceId) => [...groups.values()].filter((group) => group.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    insertGroup: (record) => { groups.set(record.id, record); messages.set(record.id, []); },
    updateGroup: (id, patch) => {
      const current = groups.get(id);
      if (current) groups.set(id, { ...current, ...patch });
    },
    deleteGroup: (id) => {
      groups.delete(id);
      messages.delete(id);
      for (const [key, member] of members) if (member.groupId === id) members.delete(key);
    },
    listMembers: (groupId) => [...members.values()].filter((member) => member.groupId === groupId)
      .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt) || left.agentId.localeCompare(right.agentId)),
    findMemberBySession: (sessionId) => [...members.values()].find((member) => member.memberSessionId === sessionId) ?? null,
    upsertMember: (record) => { members.set(memberKey(record.groupId, record.agentId), record); },
    updateMember: (groupId, agentId, patch) => {
      const key = memberKey(groupId, agentId);
      const current = members.get(key);
      if (current) members.set(key, { ...current, ...patch });
    },
    deleteMember: (groupId, agentId) => { members.delete(memberKey(groupId, agentId)); },
    appendMessage: (message) => {
      const list = messages.get(message.groupId) ?? [];
      const record = { ...message, seq: (list.at(-1)?.seq ?? 0) + 1 };
      list.push(record);
      messages.set(message.groupId, list);
      return record;
    },
    listMessages: (groupId, query) => {
      const matching = (messages.get(groupId) ?? []).filter(inRange(query));
      return query.take === 'oldest' ? matching.slice(0, query.limit) : matching.slice(-query.limit);
    },
    countMessages: (groupId, range) => (messages.get(groupId) ?? []).filter(inRange(range)).length,
    latestSeq: (groupId) => (messages.get(groupId) ?? []).at(-1)?.seq ?? 0,
    hasSourceMessage: (groupId, sourceMessageId) => (messages.get(groupId) ?? []).some((message) => message.authorKind === 'agent' && message.sourceMessageId === sourceMessageId),
  };
}

let current: AgentGroupsService | null = null;

export function installAgentGroups(service: AgentGroupsService | null): void {
  current = service;
}

/** The installed group chat service; null when the host runs no groups. */
export function agentGroups(): AgentGroupsService | null {
  return current;
}
