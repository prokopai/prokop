import type { AgentEndpoint } from '@prokopai/agent-protocol';
import type { WorkspaceMcpResult, WorkspaceMcpToolsPort } from '@/application/ports/mcp-tools';
import { capabilityToolFromMcp } from '@/infrastructure/mcp/capability-tool';
import type { WorkspaceToolDiscovery } from '@/infrastructure/tools/tool-source';
import type { Session, Workspace } from '@prokopai/sdk/types';
import type { SessionSearchService, TerminalAccess } from './host-tools';

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

/**
 * The session search host port (`harnesses/shared/session-search/host.ts`),
 * every method one typed `search.*` request.
 */
export function createProtocolSessionSearchHost(endpoint: AgentEndpoint): SessionSearchService {
  const request = endpoint.request.bind(endpoint);
  return {
    getWorkspace: async id => await request('search.workspace', { id }) as Workspace | null,
    getSession: async id => await request('search.session', { id }) as Session | null,
    listWorkspaceSessions: async workspaceId => await request('search.workspaceSessions', { workspaceId }) as Session[],
    listAgentSessions: async (agentId, limit) => await request('search.agentSessions', { agentId, limit }) as Session[],
    countSessionMessages: async (sessionId: string) => (await request('search.countMessages', { sessionId })).count,
    searchMessages: options => request('search.messages', options),
    countMessagesBefore: async (sessionId: string, timestamp: number) =>
      (await request('search.countBefore', { sessionId, timestamp })).count,
    countMessagesAfter: async (sessionId: string, timestamp: number) =>
      (await request('search.countAfter', { sessionId, timestamp })).count,
    getLatestMessage: (sessionId: string) => request('search.latestMessage', { sessionId }),
    getMessage: (messageId: string, sessionId: string) => request('search.message', { messageId, sessionId }),
    listMessagesBefore: (sessionId: string, timestamp: number, limit: number) =>
      request('search.messagesBefore', { sessionId, timestamp, limit }),
    listMessagesAfter: (sessionId: string, timestamp: number, limit: number) =>
      request('search.messagesAfter', { sessionId, timestamp, limit }),
    getMessageSummary: (messageId: string) => request('search.messageSummary', { messageId }),
  };
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
