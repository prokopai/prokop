import type { Part } from './message';
import type { PermissionMode } from './session';

/**
 * A group chat: one shared thread between the person and 2 to 10 of their
 * agents in one workspace. Each member answers from its own member session
 * (a hidden top-level session on the agent's harness); the group transcript
 * is the shared record every member catches up on when it is woken.
 */
export interface AgentGroup {
  id: string;
  workspaceId: string;
  name: string;
  /** The member woken by a message that mentions nobody. */
  defaultAgentId: string;
  /** The permission mode every member session runs with; the group is the only place it is set. */
  permissionMode: PermissionMode;
  members: AgentGroupMember[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentGroupMember {
  agentId: string;
  name: string;
  /** The hidden session this member answers from. */
  sessionId: string;
  /** The newest group message this member has already received. */
  cursorSeq: number;
  joinedAt: string;
}

/** `user`: the person. `agent`: a member's reply. `handoff`: a member passing a stage on. `system`: joins and leaves. */
export type AgentGroupMessageAuthorKind = 'user' | 'agent' | 'handoff' | 'system';

export interface AgentGroupMessage {
  id: string;
  groupId: string;
  /** Position in the group, from 1, dense. */
  seq: number;
  authorKind: AgentGroupMessageAuthorKind;
  /** The member who wrote it; null for the person and for system lines. */
  authorAgentId: string | null;
  /** A handoff's recipient. */
  targetAgentId: string | null;
  /** The member session message a reply was copied from. */
  sourceMessageId: string | null;
  /** The same part shapes as session messages; tool parts carry only name, status and summary. */
  parts: Part[];
  /** Hops from the person's message: 0 for the person, +1 per handoff. */
  hop: number;
  createdAt: string;
}
