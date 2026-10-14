/**
 * C2 composition helpers. Scope creation is async (kernel activation);
 * entering a composed agent scope is fully synchronous: every service is
 * resolved and every AsyncLocalStorage accessor is seeded before the
 * callback starts, so no async work runs with unseeded accessors.
 */

import { withRuntimeConfiguration } from '@prokopai/core/infrastructure/providers/configuration/runtime';
import { withContextAssembler } from '#agent/harnesses/prokop/context/assembler';
import { withContextSources } from '#agent/harnesses/prokop/context/sources';
import { withRetryPolicy } from '#agent/harnesses/prokop/retry/policy';
import { withCompactionService } from '#agent/harnesses/prokop/compaction/policy';
import { withAskPermissionPolicy } from '#agent/harnesses/prokop/permission/policy';
import { withPermissionRuntimeService } from '#agent/harnesses/prokop/permission/runtime';
import { withWorkspaceService } from '@prokopai/core/infrastructure/filesystem/workspace-policy/policy';
import { withToolOutputService } from '#agent/harnesses/prokop/tool-output/policy';
import { withGoalDomain } from '#agent/harnesses/prokop/goals/service';
export { createAgentScope, createProcessScope } from '#agent/harnesses/prokop/composition/kernel/kernel';
import type { AgentScopeHandle } from '#agent/harnesses/prokop/composition/kernel/types';
import { withProviderOverrides } from '@prokopai/core/infrastructure/providers/registry';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  isDomainToolPayload,
  withContributedDomainToolPayloads,
  type DomainToolPayload,
} from '@prokopai/core/infrastructure/tools/domain-tool-source';
import { withRuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { withSandboxController } from '@prokopai/core/infrastructure/sandbox/controller';
import { withStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { withToolRegistryResolver } from '@prokopai/core/infrastructure/tools/registry';
import { withWorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';
import {
  capekContextAssemblerKey,
  capekGoalDomainKey,
  capekContextSourcesKey,
  capekProviderOverridesKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekRetryPolicyKey,
  capekCompactionServiceKey,
  capekPermissionPolicyKey,
  capekPermissionRuntimeKey,
  capekWorkspacePolicyKey,
  capekToolOutputPolicyKey,
  capekSandboxControllerKey,
  capekStorageKey,
  capekToolResolverKey,
  capekWorkspaceToolDiscoveryKey,
} from '#agent/harnesses/prokop/composition/plugins/service-keys';

/**
 * Synchronously seeds every current accessor from the composed agent scope
 * and then runs the callback. Seeding order is fixed: storage, runtime
 * configuration, runtime host, context sources, provider overrides, optional
 * tool resolver, tool source, sandbox controller, context assembler. The
 * optional resolver layer is omitted when no plugin contributed it,
 * exactly like the unseeded installed-tool path today. The scope's
 * assembler is bound to this scope at composition time and seeded here
 * through the context-assembler ALS runtime, so ordered context assembly
 * always resolves this exact scope, even across async suspensions and
 * interleaved scopes.
 *
 * Contributed domain tool payloads are seeded generically from the scope's
 * visible tool contributions carrying `DOMAIN_TOOL_PAYLOAD_FIELD`; an empty
 * map means a composed scope without domain payloads, which disables the
 * unscoped legacy fallbacks for the callback duration.
 */
export function enterAgentScope<T>(scope: AgentScopeHandle, callback: () => T): T {
  const storage = scope.require(capekStorageKey);
  const configuration = scope.require(capekRuntimeConfigurationKey);
  const host = scope.require(capekRuntimeHostKey);
  const retryPolicy = scope.require(capekRetryPolicyKey);
  const compactionService = scope.require(capekCompactionServiceKey);
  const permissionPolicy = scope.require(capekPermissionPolicyKey);
  const permissionRuntime = scope.require(capekPermissionRuntimeKey);
  const workspacePolicy = scope.require(capekWorkspacePolicyKey);
  const toolOutputPolicy = scope.require(capekToolOutputPolicyKey);
  const contextSources = scope.require(capekContextSourcesKey);
  const providerOverrides = scope.require(capekProviderOverridesKey);
  const workspaceToolDiscovery = scope.require(capekWorkspaceToolDiscoveryKey);
  const sandboxController = scope.require(capekSandboxControllerKey);
  const toolResolver = scope.optional(capekToolResolverKey);
  const contextAssembler = scope.require(capekContextAssemblerKey);
  const goalDomain = scope.optional(capekGoalDomainKey);

  const domainToolPayloads = new Map<string, DomainToolPayload>();
  for (const tool of scope.listTools()) {
    if (!tool.visible) continue;
    const candidate = tool.definition[DOMAIN_TOOL_PAYLOAD_FIELD];
    if (isDomainToolPayload(candidate) && candidate.name === tool.definition.name) {
      domainToolPayloads.set(candidate.name, candidate);
    }
  }

  const resolveTools = toolResolver === undefined
    ? (inner: () => T): T => withWorkspaceToolDiscovery(workspaceToolDiscovery, () =>
      withSandboxController(sandboxController, inner))
    : (inner: () => T): T => withToolRegistryResolver(toolResolver, () =>
      withWorkspaceToolDiscovery(workspaceToolDiscovery, () =>
        withSandboxController(sandboxController, inner)));

  const resolveGoalDomain = goalDomain === undefined
    ? (inner: () => T): T => inner()
    : (inner: () => T): T => withGoalDomain(goalDomain, inner);

  return withContributedDomainToolPayloads(domainToolPayloads, () =>
    resolveGoalDomain(() =>
      withContextAssembler(contextAssembler, () =>
        withRetryPolicy(retryPolicy, () =>
          withCompactionService(compactionService, () =>
            withAskPermissionPolicy(permissionPolicy, () =>
              withPermissionRuntimeService(permissionRuntime, () =>
                withWorkspaceService(workspacePolicy, () =>
                  withToolOutputService(toolOutputPolicy, () =>
                    withStorage(storage, () =>
                      withRuntimeConfiguration(configuration, () =>
                        withRuntimeHost(host, () =>
                          withContextSources(contextSources, () =>
                            withProviderOverrides(providerOverrides, () =>
                              resolveTools(callback)))))))))))))));
}

export type {
  AgentScopeHandle,
  RuntimePlugin,
  ProcessScopeHandle,
  ToolDefinition,
} from '#agent/harnesses/prokop/composition/kernel/types';
