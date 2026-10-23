import type { AnyVisualization } from '@prokopai/sdk';
import type { WorkspaceMcpResult } from './mcp-tools';

/**
 * Tool surfaces the agent runtime serves to sessions through the workspace
 * MCP tool list without an MCP settings entry: no server to configure, no
 * toggle, no per-tool disable. The host's MCP manager appends them after the
 * configured servers and reads the provider at call time, so a host that
 * starts without the agent runtime lists nothing instead of failing.
 */
export interface AgentRuntimeTools {
  /** Shown as the tools' server name (display and the Claude tool prefix). */
  name: string;
  definitions: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];
  /** Whether a session sees these tools at all (agent settings). */
  visibleTo(sessionId: string): Promise<boolean>;
  execute(name: string, input: Record<string, unknown>, sessionId: string, workspacePath: string,
    signal: AbortSignal | undefined, allowed: () => Promise<boolean>): Promise<WorkspaceMcpResult>;
  /** The transcript row of a completed call, for harnesses that render MCP results generically. */
  visualize?(name: string, input: Record<string, unknown>, result: WorkspaceMcpResult): AnyVisualization | null;
}

let current: AgentRuntimeTools | null = null;

export function installAgentRuntimeTools(provider: AgentRuntimeTools | null): void {
  current = provider;
}

export function agentRuntimeTools(): AgentRuntimeTools | null {
  return current;
}
