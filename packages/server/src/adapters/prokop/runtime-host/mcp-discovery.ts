import type { WorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';
import type { Preconfig } from '@prokopai/sdk/types';
import type { CapabilityTool } from '@prokopai/core/infrastructure/providers/ai-sdk';

interface McpDiscoveryDeps {
  session(id: string): { workspaceId: string; preconfigId?: string | null } | null;
  workspacePath(id: string): string | null;
  preconfig(id: string | null): Promise<Preconfig | null>;
  tools(path: string, sessionId: string, authorized?: () => Promise<boolean>): Promise<Record<string, CapabilityTool>>;
}

/** The session state MCP access was granted for. Any change revokes access. */
export interface McpAccessContext {
  workspaceId: string;
  preconfigId: string | null;
  path: string;
}

/**
 * MCP access is granted to the session as it was when the tools were built:
 * the same workspace, agent and path, and an agent that still exists. The
 * agent's mode does not matter; a subagent-mode role gets the same servers
 * and built-ins as a primary agent, and its own settings decide what it may do.
 */
export function createMcpAccess(deps: Omit<McpDiscoveryDeps, 'tools'>): {
  grant(sessionId: string): Promise<McpAccessContext | null>;
  check(sessionId: string, context: McpAccessContext): Promise<boolean>;
} {
  const check = async (sessionId: string, context: McpAccessContext): Promise<boolean> => {
    const current = deps.session(sessionId);
    if (!current || current.workspaceId !== context.workspaceId
      || (current.preconfigId ?? null) !== context.preconfigId
      || deps.workspacePath(current.workspaceId) !== context.path) return false;
    return !!(await deps.preconfig(context.preconfigId));
  };
  return {
    async grant(sessionId) {
      const session = deps.session(sessionId);
      if (!session) return null;
      const path = deps.workspacePath(session.workspaceId);
      if (!path) return null;
      const context = { workspaceId: session.workspaceId, preconfigId: session.preconfigId ?? null, path };
      return await check(sessionId, context) ? context : null;
    },
    check,
  };
}

export function createProkopMcpDiscovery(deps: McpDiscoveryDeps): WorkspaceToolDiscovery {
  const access = createMcpAccess(deps);
  return {
    initializeWorkspace: async () => {},
    async discoverTools(_path, sessionId) {
      if (!sessionId) return {};
      const context = await access.grant(sessionId);
      if (!context) return {};
      return deps.tools(context.path, sessionId, () => access.check(sessionId, context));
    },
  };
}
