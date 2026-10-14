import type { AgentEndpoint } from '@prokopai/agent-protocol';
import type { WorkspaceMcpResult, WorkspaceMcpToolsPort } from '@/application/ports/mcp-tools';
import { capabilityToolFromMcp } from '@/infrastructure/mcp/capability-tool';
import type { WorkspaceToolDiscovery } from '@/infrastructure/tools/tool-source';
import type { TerminalAccess } from './host-tools';

/**
 * Agent-side MCP discovery: definitions and access context come from the
 * host; each tool converts its result exactly like the in-process path.
 */
export function createProtocolToolDiscovery(endpoint: AgentEndpoint): WorkspaceToolDiscovery {
  const request = endpoint.request.bind(endpoint);
  return {
    initializeWorkspace: async () => {},
    async discoverTools(workspacePath, sessionId) {
      if (!sessionId) return {};
      const { tools, context } = await request('tool.list', { source: 'mcp', workspacePath, sessionId });
      if (!context) return {};
      return Object.fromEntries(tools.map(definition => [definition.name, capabilityToolFromMcp({
        ...definition,
        serverName: definition.serverName ?? '',
        toolName: definition.toolName ?? definition.name,
      }, {
        call: async (input, signal) => await request('tool.call', {
          source: 'mcp', name: definition.name, workspacePath, sessionId, arguments: input, context,
        }, { signal }) as WorkspaceMcpResult,
      })]));
    },
  };
}

/**
 * Agent-side MCP tools for Claude Code and Codex turns: the host grants
 * access when listing and re-checks it on every call; the turn's own
 * `authorized` check also runs before each call.
 */
export function createProtocolMcpTools(endpoint: AgentEndpoint): WorkspaceMcpToolsPort {
  const request = endpoint.request.bind(endpoint);
  return {
    async tools(workspacePath, sessionId) {
      if (!sessionId) return [];
      const { tools, context } = await request('tool.list', { source: 'mcp', workspacePath, sessionId });
      if (!context) return [];
      return tools.map(definition => ({
        ...definition,
        serverName: definition.serverName ?? '',
        toolName: definition.toolName ?? definition.name,
        execute: async (input, signal, authorized) => {
          if (authorized && !await authorized()) throw new Error('MCP access is not allowed for this agent');
          return await request('tool.call', {
            source: 'mcp', name: definition.name, workspacePath, sessionId, arguments: input, context,
          }, { signal }) as WorkspaceMcpResult;
        },
      }));
    },
  };
}

const SESSION_SEARCH_OPS = [
  'getWorkspace', 'getSession', 'listWorkspaceSessions', 'listAgentSessions', 'countSessionMessages',
  'searchMessages', 'countMessagesBefore', 'countMessagesAfter', 'getLatestMessage', 'getMessage',
  'listMessagesBefore', 'listMessagesAfter', 'getMessageSummary',
] as const;

/** The session search host port, every method a `sessionSearch.call`. */
export function createProtocolSessionSearchHost(
  endpoint: AgentEndpoint,
): Record<(typeof SESSION_SEARCH_OPS)[number], (...args: unknown[]) => Promise<unknown>> {
  const call = (op: (typeof SESSION_SEARCH_OPS)[number]) => async (...args: unknown[]) =>
    (await endpoint.request('sessionSearch.call', { op, args })).value;
  return Object.fromEntries(SESSION_SEARCH_OPS.map(op => [op, call(op)])) as
    Record<(typeof SESSION_SEARCH_OPS)[number], (...args: unknown[]) => Promise<unknown>>;
}

/** Sends approved memory and skill writes to the host. */
export function createProtocolKnowledgeWrite(endpoint: AgentEndpoint) {
  return (kind: 'memory' | 'skill', directory: string, input: Record<string, unknown>): Promise<Record<string, unknown>> =>
    endpoint.request('knowledge.apply', { kind, directory, input });
}

/** Host terminals over `terminal.*`. */
export function createProtocolTerminals(endpoint: AgentEndpoint): TerminalAccess {
  const request = endpoint.request.bind(endpoint);
  return {
    create: async options => (await request('terminal.create', options)).terminalId,
    get: async id => (await request('terminal.get', { terminalId: id })).info,
    executionCwd: async id => (await request('terminal.get', { terminalId: id })).executionCwd,
    setCwd: async (id, cwd) => (await request('terminal.setCwd', { terminalId: id, cwd })).written,
    write: async (id, data) => (await request('terminal.write', { terminalId: id, data })).written,
    read: (id, fromOffset, maxBytes) => request('terminal.read', { terminalId: id, fromOffset, maxBytes }),
    list: workspacePath => request('terminal.list', { workspacePath }),
    destroy: async (id) => {
      await request('terminal.destroy', { terminalId: id });
    },
  };
}
