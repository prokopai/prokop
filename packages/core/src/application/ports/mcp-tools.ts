import type { AnyVisualization } from '@prokopai/sdk';

/** Host-owned MCP tools, independent of any agent SDK. */
export interface WorkspaceMcpTool {
  name: string;
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, signal?: AbortSignal, authorized?: () => boolean | Promise<boolean>): Promise<WorkspaceMcpResult>;
  /** The transcript row of a completed call; absent means a generic completion chip. */
  visualize?(input: Record<string, unknown>, result: WorkspaceMcpResult): AnyVisualization | null;
}
export interface WorkspaceMcpResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
export interface WorkspaceMcpToolsPort {
  /** Effective global and workspace tools, with workspace server names taking precedence. */
  tools(workspacePath: string, sessionId?: string): Promise<WorkspaceMcpTool[]>;
}

let harnessMcp: WorkspaceMcpToolsPort | null = null;

/** The MCP tools Claude Code and Codex turns see. */
export function configureHarnessMcpTools(port: WorkspaceMcpToolsPort): void {
  harnessMcp = port;
}

export function harnessMcpTools(): WorkspaceMcpToolsPort {
  if (!harnessMcp) throw new Error('Harness MCP tools are not configured');
  return harnessMcp;
}
