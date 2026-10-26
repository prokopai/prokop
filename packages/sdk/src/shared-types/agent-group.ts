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
  /**
   * The member session message a reply was copied from. On a handoff, the
   * reply of the turn that posted it, which the thread shows ahead of it.
   */
  sourceMessageId: string | null;
  /** The same part shapes as session messages; tool parts carry only name, status and summary. */
  parts: Part[];
  /** Hops from the person's message: 0 for the person, +1 per handoff. */
  hop: number;
  createdAt: string;
}

type GroupThreadEntry = Pick<AgentGroupMessage, 'seq' | 'authorKind' | 'sourceMessageId'>;

/**
 * The seq of the first message a member's turn posted to the thread (its
 * handoffs carry the turn's reply as their source), or null when it posted
 * none. The reply, and its live preview while the turn runs, read there.
 */
export function groupTurnAnchor(messages: readonly GroupThreadEntry[], replyMessageId: string): number | null {
  let anchor: number | null = null;
  for (const message of messages) {
    if (message.authorKind !== 'agent' && message.sourceMessageId === replyMessageId && (anchor === null || message.seq < anchor)) anchor = message.seq;
  }
  return anchor;
}

/**
 * A group thread (oldest first, as stored and listed) in reading order. A
 * member's reply is copied in only when its turn ends, after the handoffs
 * that turn already posted; the reply moves ahead of the first of them,
 * where its turn began. Everything else keeps the order it came in.
 */
export function orderGroupThread<T extends GroupThreadEntry>(messages: readonly T[]): T[] {
  const anchors = new Map<string, T>();
  for (const message of messages) {
    if (message.authorKind === 'agent' || !message.sourceMessageId) continue;
    const seen = anchors.get(message.sourceMessageId);
    if (!seen || message.seq < seen.seq) anchors.set(message.sourceMessageId, message);
  }
  const ahead = new Map<T, T>();
  for (const message of messages) {
    const anchor = message.authorKind === 'agent' && message.sourceMessageId ? anchors.get(message.sourceMessageId) : undefined;
    if (anchor && anchor.seq < message.seq) ahead.set(anchor, message);
  }
  if (ahead.size === 0) return [...messages];
  const moved = new Set(ahead.values());
  const ordered: T[] = [];
  for (const message of messages) {
    if (moved.has(message)) continue;
    const reply = ahead.get(message);
    if (reply) ordered.push(reply);
    ordered.push(message);
  }
  return ordered;
}
