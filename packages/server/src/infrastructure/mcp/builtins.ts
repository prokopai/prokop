import { BUILTIN_MCP_NAMES, type McpBuiltinId, type McpStatus } from '@prokopai/sdk';
import type { WorkspaceMcpResult } from '@prokopai/core/application/ports/mcp-tools';
import { browserTools } from '@prokopai/core/infrastructure/browser/catalog';
import { browserConnection, browserService } from '@/infrastructure/browser/service';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { renderHtml, renderHtmlDefinition } from '@/infrastructure/visuals/render-html';

export interface BuiltinMcpDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A tool surface shipped with the server and listed as one MCP entry. */
export interface BuiltinMcp {
  definitions: readonly BuiltinMcpDefinition[];
  status(): McpStatus;
  /** Whether a session sees these tools at all. */
  visibleTo(sessionId: string): boolean;
  execute(name: string, input: Record<string, unknown>, sessionId: string, workspacePath: string,
    signal: AbortSignal | undefined, allowed: () => Promise<boolean>, timeout?: number): Promise<WorkspaceMcpResult>;
}

export const builtinMcps: Record<McpBuiltinId, BuiltinMcp> = {
  browser: {
    definitions: browserTools.map(tool => tool.definition as BuiltinMcpDefinition),
    status: () => browserConnection() ? { status: 'connected' }
      : { status: 'failed', error: 'Connect exactly one Prokop Browser extension.' },
    visibleTo: () => true,
    execute: (name, input, sessionId, path, signal, allowed, timeout) =>
      browserService.execute(name, input, sessionId, path, signal, allowed, timeout),
  },
  visuals: {
    definitions: [renderHtmlDefinition],
    status: () => ({ status: 'connected' }),
    // A render shows in the session that called it. Nobody watches a subagent's
    // or a learning review's.
    visibleTo: sessionId => {
      const session = getSession(sessionId);
      return !!session && !session.parentId && !session.metadata?.learningRunId;
    },
    execute: async (name, input, sessionId, path, signal, allowed) => {
      if (name !== renderHtmlDefinition.name) throw new Error('Unknown Prokop Visuals tool');
      return renderHtml(input, sessionId, path, signal, allowed);
    },
  },
};

const builtinNames = new Set(Object.values(BUILTIN_MCP_NAMES));

export function isBuiltinMcpName(name: string): boolean {
  return builtinNames.has(name);
}
