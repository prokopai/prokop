import { configureWorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';
import { listDomainToolFallbackDefinitions } from '@prokopai/core/infrastructure/tools/domain-tool-source';
import type { ToolCatalogEntry } from '@prokopai/core/application/ports/tool-catalog';
import { getTools } from '@/infrastructure/mcp';
import type { LoadedTool } from '@prokopai/sdk/tool';
import { getBuiltinToolsPort } from '@prokopai/core/application/ports/builtin-tools';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { getDefaultPreconfig, getPreconfig } from '@prokopai/core/infrastructure/config/preconfig';
import { createProkopMcpDiscovery } from '@/adapters/prokop/runtime-host/mcp-discovery';
import { browserTools } from '@prokopai/core/infrastructure/browser/catalog';
const browserNames = new Set(browserTools.map(tool => tool.definition.name));

/** Harness-owned built-ins, read through the installed port at call time
 * so this adapter never imports harness internals. */
function exposedBuiltinTools(): readonly LoadedTool[] {
  return getBuiltinToolsPort()?.tools() ?? [];
}

/** The Jean2 workspace tool discovery: the MCP manager's per-workspace
 * client lifecycle and tool listing. */
const mcpAccessDeps = {
  session: getSession,
  workspacePath: (id: string) => getWorkspace(id)?.path ?? null,
  // Preconfigs straight from the config store: MCP access needs only their MCP settings,
  // so the host does not load the Prokop runtime's preconfig source.
  preconfig: async (id: string | null) => id ? await getPreconfig(id) : getDefaultPreconfig(),
};

export const prokopWorkspaceToolDiscovery = createProkopMcpDiscovery({ ...mcpAccessDeps, tools: getTools });

/** Capek tool catalog seam for the tools route (S4): the baked-in baseline
 * and the capek domain tools. Built-ins win on name collision. MCP tools are
 * per workspace and listed by the MCP routes, not here. */
export const prokopToolCatalog = {
  listTools: async (): Promise<ToolCatalogEntry[]> => {
    const builtins = exposedBuiltinTools();
    const builtinNames = new Set(builtins.map((tool) => tool.definition.name));
    const domains = listDomainToolFallbackDefinitions()
      .map((definition) => ({ ...definition, source: 'domain' as const }));
    return [
      ...builtins.map((tool) => ({ ...tool.definition, source: 'builtin' as const })),
      ...domains.filter((tool) => !builtinNames.has(tool.name)),
    ].sort((a, b) => a.name.localeCompare(b.name));
  },
  getTool: async (name: string) => {
    if (browserNames.has(name)) return null;
    return exposedBuiltinTools().find((tool) => tool.definition.name === name) ?? null;
  },
};

export function configureProkopWorkspaceToolDiscovery(): void {
  configureWorkspaceToolDiscovery(prokopWorkspaceToolDiscovery);
}
