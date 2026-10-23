import type { AnyVisualization } from '@prokopai/sdk';
import type { WorkspaceMcpResult } from './mcp-tools';

/**
 * Tool surfaces the agent runtime serves to sessions through the workspace
 * MCP tool list without an MCP settings entry: no server to configure, no
 * toggle, no per-tool disable. The host's MCP manager appends them after the
 * configured servers and reads the providers at call time, so a host that
 * starts without the agent runtime lists nothing instead of failing. Each
 * provider is one built-in (delegation, messaging) with its own server name.
 */
export interface AgentRuntimeTools {
  /** Shown as the tools' server name (display and the Claude tool prefix). */
  name: string;
  /** The tools as this session sees them; descriptions may read live catalogs (effort ladders, agents). */
  definitions(sessionId: string): Promise<readonly { name: string; description: string; inputSchema: Record<string, unknown> }[]>;
  /** Whether a session sees these tools at all (agent settings). */
  visibleTo(sessionId: string): Promise<boolean>;
  execute(name: string, input: Record<string, unknown>, sessionId: string, workspacePath: string,
    signal: AbortSignal | undefined, allowed: () => Promise<boolean>): Promise<WorkspaceMcpResult>;
  /** The transcript row of a completed call, for harnesses that render MCP results generically. */
  visualize?(name: string, input: Record<string, unknown>, result: WorkspaceMcpResult): AnyVisualization | null;
}

let current: AgentRuntimeTools[] = [];

/** One provider, a list, or null to serve nothing. */
export function installAgentRuntimeTools(providers: AgentRuntimeTools | readonly AgentRuntimeTools[] | null): void {
  current = providers ? (Array.isArray(providers) ? [...providers] : [providers as AgentRuntimeTools]) : [];
}

export function agentRuntimeTools(): readonly AgentRuntimeTools[] {
  return current;
}
