/**
 * Built-in tool resolver plugin.
 *
 * Contributes the baked-in baseline tools and provides the agent-scope
 * tool resolver over the scope's contributed catalog: built-ins, domain
 * payloads and the tool-output policy's retrieve-tool-output. Browser tools
 * are built by their own path and never resolve here.
 */

import type { LoadedTool } from '@prokopai/sdk/tool';
import type { ToolRegistryResolver } from '@prokopai/core/infrastructure/tools/registry';
import { createContributedToolResolver } from '#agent/harnesses/prokop/composition/plugins/tool-catalog';
import { loadedToolsPlugin } from '#agent/harnesses/prokop/composition/plugins/loaded-tools';
import { capekToolResolverKey } from '#agent/harnesses/prokop/composition/plugins/service-keys';
import type { RuntimePlugin } from '#agent/harnesses/prokop/composition/plugins/compose';
import { browserTools } from '@prokopai/core/infrastructure/browser/catalog';

const browserNames = new Set(browserTools.map(tool => tool.definition.name));

/** The contributed resolver without the browser tools. */
export function createScopedToolResolver(contributed: ToolRegistryResolver): ToolRegistryResolver {
  return {
    get(name: string): LoadedTool | null {
      if (browserNames.has(name)) return null;
      return contributed.get(name);
    },
    list(): LoadedTool[] {
      return contributed.list();
    },
  };
}

/** The built-in tools agent plugins: one plugin contributing the
 * harness-owned baked-in baseline (passed explicitly by the composition
 * profile, which owns the harness tool set), one providing the resolver
 * over the scope's contributed catalog (which includes those built-ins, the
 * tool-output policy's retrieval tool, and domain tool payloads). */
export function builtinToolsAgentPlugins(tools: readonly LoadedTool[]): readonly RuntimePlugin<unknown>[] {
  return [
    loadedToolsPlugin('prokopai.builtin-tools', tools),
    {
      id: 'prokopai.tool-resolver',
      scope: 'agent',
      provides: [capekToolResolverKey],
      setup(context) {
        context.provide(capekToolResolverKey, createScopedToolResolver(createContributedToolResolver(context)));
      },
    },
  ];
}
