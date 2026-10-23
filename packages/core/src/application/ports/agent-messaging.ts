import type { SessionHarness } from '@prokopai/sdk';

/**
 * What agent messaging needs from the host: a way to put a message in front
 * of a session's model (the delivery primitive), a recipient's home
 * workspace, the hop limit, and the conversation rows that link a sender
 * session to its conversation in a recipient's home. Installed by the server
 * bootstrap; without it no agent has a home, so every message is refused
 * and nothing is written, and tests need no wiring.
 */

/**
 * One conversation per sender session and recipient agent: a top-level
 * session in the recipient's home that keeps its context across messages
 * from the same sender session. Keyed by its own id; the recipient session
 * id is the session that answers.
 */
export interface AgentConversationRecord {
  id: string;
  senderSessionId: string;
  /** The sender session's agent; null for a session that runs no agent. */
  senderAgentId: string | null;
  recipientAgentId: string;
  recipientSessionId: string;
  /** The wake (a user message id) whose turn sent an explicit result; its end is not auto-returned. */
  explicitResultWakeId: string | null;
  createdAt: string;
}

export interface AgentConversationStore {
  get(id: string): AgentConversationRecord | null;
  findBySender(senderSessionId: string, recipientAgentId: string): AgentConversationRecord | null;
  findByRecipientSession(recipientSessionId: string): AgentConversationRecord | null;
  /** Every conversation the session started, for the delete cascade. */
  listBySender(senderSessionId: string): AgentConversationRecord[];
  upsert(record: AgentConversationRecord): void;
  delete(id: string): void;
}

/** An in-memory store for hosts and tests without persistence. */
export function createMemoryAgentConversationStore(): AgentConversationStore {
  const rows = new Map<string, AgentConversationRecord>();
  return {
    get: (id) => rows.get(id) ?? null,
    findBySender: (senderSessionId, recipientAgentId) =>
      [...rows.values()].find((row) => row.senderSessionId === senderSessionId && row.recipientAgentId === recipientAgentId) ?? null,
    findByRecipientSession: (recipientSessionId) =>
      [...rows.values()].find((row) => row.recipientSessionId === recipientSessionId) ?? null,
    listBySender: (senderSessionId) => [...rows.values()].filter((row) => row.senderSessionId === senderSessionId),
    upsert: (record) => { rows.set(record.id, record); },
    delete: (id) => { rows.delete(id); },
  };
}

export interface AgentMessagingHostPort {
  /** Puts a message in front of a session's model (the delivery primitive). */
  deliver(input: { sessionId: string; content: string; key: string }): Promise<void>;
  /** The agent's home workspace, created if the agent has a home; null for an agent without one. */
  homeWorkspace(agentId: string): Promise<{ id: string; path: string } | null>;
  /**
   * Pins a CLI session's model and effort the way a new session or a
   * delegated child gets them: validated against the live CLI catalog, the
   * variant as effort when the model supports it. A CLI turn refuses to
   * start without this. No-op for Prokop, whose session fields suffice.
   */
  pinModel(input: { sessionId: string; harness: SessionHarness; model: string | null; variant: string | null }): Promise<void>;
  /** Messages may travel this many hops from a person's turn before a send is refused. */
  maxHops(): number;
  conversations: AgentConversationStore;
}

/** A person's turn is hop 0; a message sent from it is hop 1. */
export const DEFAULT_AGENT_MESSAGE_MAX_HOPS = 6;

const permissive: AgentMessagingHostPort = {
  deliver: async () => {},
  homeWorkspace: async () => null,
  pinModel: async () => {},
  maxHops: () => DEFAULT_AGENT_MESSAGE_MAX_HOPS,
  conversations: createMemoryAgentConversationStore(),
};

let current: AgentMessagingHostPort = permissive;

export function installAgentMessagingHost(port: AgentMessagingHostPort | null): void {
  current = port ?? permissive;
}

export function agentMessagingHost(): AgentMessagingHostPort {
  return current;
}
