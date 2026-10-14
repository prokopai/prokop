import type { LoadedTool, ToolDefinition, ToolResult } from '@prokopai/sdk/tool';
import { capekToolResolverKey } from '#agent/harnesses/prokop/composition/plugins/service-keys';
import type { RuntimePlugin } from '#agent/harnesses/prokop/composition/plugins/compose';
import { createContributedToolResolver } from '#agent/harnesses/prokop/composition/plugins/tool-catalog';
import { loadedToolsPlugin } from '#agent/harnesses/prokop/composition/plugins/loaded-tools';
import type { LearningScope } from '@prokopai/sdk';

export const learningHomeDefinition: ToolDefinition = {
  name: 'home_files',
  description: 'Maintain text knowledge anywhere in your own home. List/search discover files; read returns content and revision. Write or delete requires the revision from read (null for a new file). Paths are home-relative. No shell, sensitive paths, hidden directories, symlinks, binary files or recursive deletion. Keep snippets as reference material, never execute them.',
  inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['list', 'search', 'read', 'write', 'delete'] },
    path: { type: 'string' }, query: { type: 'string' }, content: { type: 'string' },
    revision: { type: ['string', 'null'] },
  }, required: ['action'], additionalProperties: false },
  timeout: 30000,
};

export interface LearningToolsOptions {
  sessionId: string;
  scope: LearningScope;
  improveSkills: boolean;
  /** Offer `home_files` (agent scope only). */
  home: boolean;
  /** Definitions from the published catalog; never load installed executable tools. */
  definitions: readonly ToolDefinition[];
  /** Runs a review tool host-side, against the review the host opened for the session. */
  call(name: string, input: unknown): Promise<ToolResult>;
}

/** Dedicated review composition only. Do not combine with memory/skills domain
 * plugins: these registry tools deliberately replace their execution path. */
export function createLearningToolsPlugins(options: LearningToolsOptions): readonly RuntimePlugin<unknown>[] {
  const memory = options.scope === 'agent' ? 'agent_memory' : 'memory';
  const skills = options.scope === 'agent' ? 'agent_skill_manage' : 'skill_manage';
  const names = [memory, 'session_search', ...(options.scope === 'agent' && options.home ? ['home_files'] : []), ...(options.improveSkills ? [skills] : [])];
  const loaded: LoadedTool[] = names.map(name => {
    const definitions = name === 'home_files' ? [learningHomeDefinition] : options.definitions.filter(item => item.name === name);
    if (definitions.length !== 1) throw new Error(`Missing or ambiguous learning tool definition: ${name}`);
    return {
      definition: definitions[0]!,
      path: 'prokopai:learning',
      async execute(input, context) {
        if (context.sessionId !== options.sessionId || context.abortSignal.aborted) {
          return { success: false, error: 'Learning execution context is no longer authorized' };
        }
        return options.call(name, input);
      },
    };
  });
  return [
    loadedToolsPlugin('prokopai.learning-tools', loaded),
    {
      id: 'prokopai.learning-tool-resolver',
      scope: 'agent',
      provides: [capekToolResolverKey],
      setup(context) {
        const contributed = createContributedToolResolver(context);
        const allowed = new Set(names);
        context.provide(capekToolResolverKey, {
          get: name => allowed.has(name) ? contributed.get(name) : null,
          list: () => contributed.list().filter(tool => allowed.has(tool.definition.name)),
        });
      },
    },
  ];
}
