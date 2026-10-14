import type { HostHandlers } from '@prokopai/agent-protocol';
import type { WorkspaceMcpTool } from '@/application/ports/mcp-tools';

/** Session state MCP access was granted for; a change revokes access. */
export interface ToolAccessContext {
  workspaceId: string;
  preconfigId: string | null;
  path: string;
}

/** Host terminal access, same shape as the Prokop terminal port. */
export interface TerminalAccess {
  create(options: {
    cwd: string; workspaceId: string; origin: 'user' | 'agent';
    agentEnv?: Record<string, string>; title?: string; ownerSessionId?: string;
  }): Promise<string | null>;
  get(id: string): Promise<{
    id: string; title: string; cwd: string; status: string;
    exitCode?: number | null; origin?: 'user' | 'agent'; lastActivityAt?: number;
  } | null>;
  executionCwd(id: string): Promise<string | null>;
  setCwd(id: string, cwd: string): Promise<boolean>;
  write(id: string, data: string): Promise<boolean>;
  read(id: string, fromOffset: number, maxBytes: number): Promise<{ text: string; nextOffset: number; totalBytes: number } | null>;
  list(workspacePath: string): Promise<NonNullable<Awaited<ReturnType<TerminalAccess['get']>>>[]>;
  destroy(id: string): Promise<void>;
}

export interface HostToolServices {
  mcp: {
    grant(sessionId: string): Promise<ToolAccessContext | null>;
    check(sessionId: string, context: ToolAccessContext): Promise<boolean>;
    tools(path: string, sessionId: string): Promise<WorkspaceMcpTool[]>;
  };
  /** Session search port methods (shared/session-search/host.ts), called by name. */
  sessionSearch: Record<string, (...args: unknown[]) => Promise<unknown>>;
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
  const { mcp, terminals } = services;
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
    'sessionSearch.call': async ({ op, args }) => {
      const method = services.sessionSearch[op];
      if (!method) throw new Error(`Unknown session search operation ${op}`);
      return { value: (await method(...args)) ?? null };
    },
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
