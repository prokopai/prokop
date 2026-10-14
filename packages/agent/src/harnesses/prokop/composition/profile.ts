/** The Jean2 server composition profile and its exact plugin inventory. */

import type { RuntimePlugin } from '#agent/harnesses/prokop/composition/plugins/compose';
import { compactionPolicyPlugin } from '#agent/harnesses/prokop/composition/plugins/compaction-policy';
import {
  contextSourcesValuePlugin,
  installedToolRegistryValuePlugin,
  providerOverridesValuePlugin,
  providerRegistryValuePlugin,
  runtimeConfigurationValuePlugin,
  runtimeHostValuePlugin,
  sandboxControllerValuePlugin,
  sessionSearchHostValuePlugin,
  storageValuePlugin,
  workspaceToolDiscoveryValuePlugin,
} from '#agent/harnesses/prokop/composition/plugins/value-plugins';
import { createContextSectionsPlugin } from '#agent/harnesses/prokop/composition/plugins/context-sections';
import { defaultAgentDriverPlugin } from '#agent/harnesses/prokop/composition/plugins/default-agent-driver';
import { getContextSources } from '#agent/harnesses/prokop/context/sources';
import { getRuntimeConfiguration } from '@prokopai/core/infrastructure/providers/configuration/runtime';
import { getRuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { getSandboxController } from '@prokopai/core/infrastructure/sandbox/controller';
import { getSessionSearchHost } from '#agent/harnesses/shared/session-search/host';
import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { getWorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';
import { goalDomainPlugin, CURRENT_GOAL_DOMAIN_PLUGIN_ID } from '#agent/harnesses/prokop/composition/plugins/goal-domain';
import {
  memoryDomainPlugin,
  CURRENT_MEMORY_DOMAIN_PLUGIN_ID,
} from '#agent/harnesses/prokop/composition/plugins/memory-domain';
import { orchestratorSessionProviderPlugin } from '#agent/harnesses/prokop/composition/plugins/orchestrator-session';
import { permissionPolicyPlugin } from '#agent/harnesses/prokop/composition/plugins/permission-policy';
import { retryPolicyPlugin } from '#agent/harnesses/prokop/composition/plugins/retry-policy';
import {
  sessionSearchDomainPlugin,
  CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID,
} from '#agent/harnesses/prokop/composition/plugins/session-search-domain';
import {
  skillsDomainPlugin,
  CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
} from '#agent/harnesses/prokop/composition/plugins/skills-domain';
import {
  subagentDomainPlugin,
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
} from '#agent/harnesses/prokop/composition/plugins/subagent-domain';
import { toolOutputPolicyPlugin } from '#agent/harnesses/prokop/composition/plugins/tool-output-policy';
import { workspacePolicyPlugin } from '#agent/harnesses/prokop/composition/plugins/workspace-policy';
import { builtinTools } from '#agent/harnesses/prokop/tools/index';
import { builtinToolsAgentPlugins } from '#agent/harnesses/prokop/bindings/tool-resolver';
import { prokopWorkspacePolicyOptions } from '#agent/harnesses/prokop/bindings/workspace-policy';

export const JEAN2_PROCESS_PLUGIN_IDS = [
  'current.provider-registry',
  'current.installed-tool-registry',
  'current.session-search-host',
] as const;

export const JEAN2_AGENT_PLUGIN_IDS = [
  'prokopai.builtin-tools',
  'prokopai.tool-resolver',
  'current.storage',
  'current.runtime-configuration',
  'current.runtime-host',
  'current.agent-driver',
  'current.retry-policy',
  'current.compaction-policy',
  'current.permission-policy',
  'current.workspace-policy',
  'current.tool-output-policy',
  'current.context-sources',
  'current.context-sections',
  'current.orchestrator-session',
  CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID,
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
  CURRENT_GOAL_DOMAIN_PLUGIN_ID,
  CURRENT_MEMORY_DOMAIN_PLUGIN_ID,
  CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
  'current.workspace-tool-discovery',
  'current.sandbox-controller',
  'current.provider-overrides',
] as const;

export function prokopProcessPlugins(): readonly RuntimePlugin<unknown>[] {
  return [
    providerRegistryValuePlugin('current.provider-registry'),
    installedToolRegistryValuePlugin('current.installed-tool-registry'),
    sessionSearchHostValuePlugin('current.session-search-host', getSessionSearchHost()),
  ];
}

export function prokopAgentPlugins(): readonly RuntimePlugin<unknown>[] {
  return [
    ...builtinToolsAgentPlugins(builtinTools),
    storageValuePlugin('current.storage', getStorage()),
    runtimeConfigurationValuePlugin('current.runtime-configuration', getRuntimeConfiguration()),
    runtimeHostValuePlugin('current.runtime-host', getRuntimeHost()),
    defaultAgentDriverPlugin('current.agent-driver'),
    retryPolicyPlugin('current.retry-policy'),
    compactionPolicyPlugin('current.compaction-policy'),
    permissionPolicyPlugin('current.permission-policy'),
    workspacePolicyPlugin('current.workspace-policy', prokopWorkspacePolicyOptions),
    toolOutputPolicyPlugin('current.tool-output-policy'),
    contextSourcesValuePlugin('current.context-sources', getContextSources()),
    createContextSectionsPlugin('current.context-sections', {
      includeSelfDelegationGuidance: false,
      includeSessionSearchGuidance: false,
      includeMemorySkillsSections: false,
    }),
    orchestratorSessionProviderPlugin('current.orchestrator-session'),
    sessionSearchDomainPlugin(CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID),
    subagentDomainPlugin(CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID),
    goalDomainPlugin(CURRENT_GOAL_DOMAIN_PLUGIN_ID),
    memoryDomainPlugin(CURRENT_MEMORY_DOMAIN_PLUGIN_ID),
    skillsDomainPlugin(CURRENT_SKILLS_DOMAIN_PLUGIN_ID),
    workspaceToolDiscoveryValuePlugin('current.workspace-tool-discovery', getWorkspaceToolDiscovery()),
    sandboxControllerValuePlugin('current.sandbox-controller', getSandboxController()),
    providerOverridesValuePlugin('current.provider-overrides', new Map()),
  ];
}
