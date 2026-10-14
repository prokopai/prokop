/**
 * Asks whose waiters live in the agent: Claude Code and Codex approvals and
 * questions (host/agent split, decision 6 A). The host stores their rows and
 * routes the user's answer back through `resolve`, which is the agent
 * protocol's `ask.resolve`. Prokop asks resolve through `AskResolutionPort`.
 */
export interface AgentAskPort {
  /** The ask belongs to an agent-side waiter. */
  owns(toolCallId: string): boolean;
  /** Delivers the user's answer; false when the ask is no longer waiting. */
  resolve(answer: { sessionId: string; toolCallId: string; requestId?: string; response: unknown }): Promise<boolean>;
  /** The controller session of a live ask, or null. */
  sessionIdFor(toolCallId: string, requestId?: string): Promise<string | null>;
  /** The agent still waits on this request; a stale row is expired by the caller. */
  hasLiveRequest(requestId: string): boolean;
}

/** Native harness asks carry their harness in the tool call ID. */
const AGENT_ASK_PREFIXES = ['claude-approval:', 'codex-approval:'] as const;

/** Whether an ask's waiter lives in the agent, known from its ID alone (no port needed). */
export function isAgentAskId(toolCallId: string): boolean {
  return AGENT_ASK_PREFIXES.some(prefix => toolCallId.startsWith(prefix));
}

let current: AgentAskPort | null = null;

export function installAgentAskPort(port: AgentAskPort): void {
  current = port;
}

export function getAgentAskPort(): AgentAskPort | null {
  return current;
}
