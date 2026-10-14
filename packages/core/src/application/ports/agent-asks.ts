import type { AskAuthority } from '@prokopai/sdk';

/**
 * Asks whose waiters live in the agent: Prokop asks and permission requests,
 * Claude Code and Codex approvals and questions (host/agent split, decision
 * 6 A). The host stores their rows; it reads a live ask's session and
 * authority from the agent (`ask.lookup`) and routes the user's answer back
 * (`ask.resolve`).
 */
export interface AgentAskPort {
  /** The session and authority of a live ask; null when no waiter matches. */
  lookup(toolCallId: string, requestId?: string): Promise<{ sessionId: string; authority?: AskAuthority } | null>;
  /** Delivers the user's answer; false when the ask is no longer waiting. */
  resolve(answer: { sessionId?: string; toolCallId: string; requestId?: string; response: unknown }): Promise<boolean>;
  /** The agent still waits on this native harness request; a stale row is expired by the caller. */
  hasLiveRequest(requestId: string): boolean;
}

/** Native harness asks carry their harness in the tool call ID. */
const NATIVE_ASK_PREFIXES = ['claude-approval:', 'codex-approval:'] as const;

/** A Claude Code or Codex ask: answered only with its request ID, by the controller. */
export function isNativeHarnessAskId(toolCallId: string): boolean {
  return NATIVE_ASK_PREFIXES.some(prefix => toolCallId.startsWith(prefix));
}

let current: AgentAskPort | null = null;

export function installAgentAskPort(port: AgentAskPort): void {
  current = port;
}

export function getAgentAskPort(): AgentAskPort | null {
  return current;
}
