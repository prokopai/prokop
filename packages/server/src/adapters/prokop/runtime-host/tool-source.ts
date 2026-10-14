import {
  configureToolsPath,
  getTool as capekGetTool,
  listTools as capekListTools,
} from '@prokopai/core/infrastructure/tools/registry';
import { configureWorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';
import { listDomainToolFallbackDefinitions } from '@prokopai/core/infrastructure/tools/domain-tool-source';
import { resolveToolsPath } from '@prokopai/core/config';
import type { ToolCatalogEntry } from '@prokopai/core/application/ports/tool-catalog';
import { getTools } from '@/infrastructure/mcp';
import { getToolsDir } from '@prokopai/core/infrastructure/runtime/paths';
import { readEnv } from '@prokopai/core/infrastructure/runtime/env-compat';
import type { LoadedTool } from '@prokopai/sdk/tool';
import { getBuiltinToolsPort } from '@prokopai/core/application/ports/builtin-tools';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { getDefaultPreconfig, getPreconfig } from '@prokopai/core/infrastructure/config/preconfig';
import { createMcpAccess, createProkopMcpDiscovery } from '@/adapters/prokop/runtime-host/mcp-discovery';
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

/** The same MCP access rule, for hosts that serve tool calls across the agent protocol. */
export const prokopMcpAccess = createMcpAccess(mcpAccessDeps);

/** Capek tool catalog seam for the tools route (S4): the Jean2 tools
 * adapter consumes this so no non-Capek adapter imports the compat
 * barrel. Merges the baked-in baseline and the capek domain tools above
 * the installed registry: built-ins win on name collision (the scoped
 * resolver enforces the same precedence at execution time). */
export const prokopToolCatalog = {
  listTools: async (): Promise<ToolCatalogEntry[]> => {
    const builtins = exposedBuiltinTools();
    const installed = await capekListTools();
    const builtinNames = new Set(builtins.map((tool) => tool.definition.name));
    const domains = listDomainToolFallbackDefinitions()
      .map((definition) => ({ ...definition, source: 'domain' as const }));
    const domainNames = new Set(domains.map((tool) => tool.name));
    return [
      ...builtins.map((tool) => ({ ...tool.definition, source: 'builtin' as const })),
      ...domains.filter((tool) => !builtinNames.has(tool.name)),
      ...installed
        .filter((definition) => (
          !builtinNames.has(definition.name)
          && !domainNames.has(definition.name) && !browserNames.has(definition.name)
        ))
        .map((definition) => ({ ...definition, source: 'installed' as const })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  },
  getTool: async (name: string) => {
    if (browserNames.has(name)) return null;
    const builtin = exposedBuiltinTools().find((tool) => tool.definition.name === name);
    if (builtin) return builtin;
    return capekGetTool(name);
  },
};

export function configureProkopWorkspaceToolDiscovery(): void {
  try {
    configureToolsPath(resolveToolsPath());
  } catch {
    configureToolsPath(readEnv('TOOLS_PATH') || getToolsDir());
  }
  configureWorkspaceToolDiscovery(prokopWorkspaceToolDiscovery);
}
