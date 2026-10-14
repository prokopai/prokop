import type { HostHandlers } from '@prokopai/agent-protocol';
import type { WorkspaceMcpTool } from '@prokopai/core/application/ports/mcp-tools';
import type { SessionSearchService, TerminalAccess } from '@prokopai/agent';

/** Session state MCP access was granted for; a change revokes access. */
export interface ToolAccessContext {
  workspaceId: string;
  preconfigId: string | null;
  path: string;
}

export type { SessionSearchService, TerminalAccess };

export interface HostToolServices {
  mcp: {
    grant(sessionId: string): Promise<ToolAccessContext | null>;
    check(sessionId: string, context: ToolAccessContext): Promise<boolean>;
    tools(path: string, sessionId: string): Promise<WorkspaceMcpTool[]>;
  };
  /** Session search port methods (shared/session-search/host.ts), called by name. */
  /** The host's session search store (`SessionSearchHost`, harnesses/shared/session-search/host.ts). */
  sessionSearch: SessionSearchService;
  /** Applies an already-approved memory or skill write under the host knowledge lock. */
  applyKnowledge(kind: 'memory' | 'skill', directory: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  terminals: TerminalAccess;
}

const DENIED = 'MCP access is not allowed for this agent';

/**
 * Host side of the host-tool protocol: MCP (including built-in browser and
 * visuals servers), session search, approved knowledge writes and terminals.
 * Permission asks and result conversion stay in the agent.
 */
export function createToolHostHandlers(services: HostToolServices): HostHandlers {
  const { mcp, terminals, sessionSearch: search } = services;
  return {
    'tool.list': async ({ source, sessionId }) => {
      if (source !== 'mcp') throw new Error(`Tool source ${source} runs in the agent`);
      const context = sessionId ? await mcp.grant(sessionId) : null;
      if (!sessionId || !context) return { tools: [] };
      const tools = await mcp.tools(context.path, sessionId);
      return {
        tools: tools.map(({ execute: _execute, ...definition }) => definition),
        context,
      };
    },
    'tool.call': async ({ source, name, sessionId, arguments: input, context }, { signal }) => {
      if (source !== 'mcp') throw new Error(`Tool source ${source} runs in the agent`);
      if (!sessionId || !context) throw new Error(DENIED);
      const authorized = (): Promise<boolean> => mcp.check(sessionId, context);
      if (!await authorized()) throw new Error(DENIED);
      const tool = (await mcp.tools(context.path, sessionId)).find(candidate => candidate.name === name);
      if (!tool) throw new Error('MCP tool is unavailable or disabled');
      const result = await tool.execute(input, signal, authorized);
      return result;
    },
    'search.workspace': ({ id }) => search.getWorkspace(id),
    'search.session': ({ id }) => search.getSession(id),
    'search.workspaceSessions': ({ workspaceId }) => search.listWorkspaceSessions(workspaceId),
    'search.agentSessions': ({ agentId, limit }) => search.listAgentSessions(agentId, limit),
    'search.countMessages': async ({ sessionId }) => ({ count: await search.countSessionMessages(sessionId) }),
    'search.messages': options => search.searchMessages(options),
    'search.countBefore': async ({ sessionId, timestamp }) => ({ count: await search.countMessagesBefore(sessionId, timestamp) }),
    'search.countAfter': async ({ sessionId, timestamp }) => ({ count: await search.countMessagesAfter(sessionId, timestamp) }),
    'search.latestMessage': ({ sessionId }) => search.getLatestMessage(sessionId),
    'search.message': ({ messageId, sessionId }) => search.getMessage(messageId, sessionId),
    'search.messagesBefore': ({ sessionId, timestamp, limit }) => search.listMessagesBefore(sessionId, timestamp, limit),
    'search.messagesAfter': ({ sessionId, timestamp, limit }) => search.listMessagesAfter(sessionId, timestamp, limit),
    'search.messageSummary': ({ messageId }) => search.getMessageSummary(messageId),
    'knowledge.apply': ({ kind, directory, input }) => services.applyKnowledge(kind, directory, input),

    'terminal.create': async ({ cwd, workspaceId, origin, agentEnv, title, ownerSessionId }) => ({
      terminalId: await terminals.create({ cwd, workspaceId, origin: origin ?? 'agent', agentEnv, title, ownerSessionId }),
    }),
    'terminal.get': async ({ terminalId }) => ({
      info: await terminals.get(terminalId),
      executionCwd: await terminals.executionCwd(terminalId),
    }),
    'terminal.list': ({ workspacePath }) => terminals.list(workspacePath),
    'terminal.write': async ({ terminalId, data }) => ({ written: await terminals.write(terminalId, data) }),
    'terminal.read': ({ terminalId, fromOffset, maxBytes }) =>
      terminals.read(terminalId, fromOffset ?? 0, maxBytes ?? 64 * 1024),
    'terminal.setCwd': async ({ terminalId, cwd }) => ({ written: await terminals.setCwd(terminalId, cwd) }),
    'terminal.destroy': async ({ terminalId }) => {
      await terminals.destroy(terminalId);
      return {};
    },
  };
}
