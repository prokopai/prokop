import type { Preconfig } from '@prokopai/sdk/types'
import type { ToolDefinition } from '@prokopai/sdk/tool';
import { validateContextAssemblyData, type ContextAssemblyData } from '#agent/harnesses/prokop/context/assembler';
import { serviceKey } from '#agent/harnesses/prokop/composition/kernel/service-key';
import type {
  RuntimePlugin,
  ContextSectionContribution,
  PluginContext,
  ToolDefinition as KernelToolDefinition,
} from '#agent/harnesses/prokop/composition/kernel/types';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  registerDomainToolFallback,
  type DomainToolPayload,
} from '@prokopai/core/infrastructure/tools/domain-tool-source';
import type { RuntimeDelivery, RuntimeEvent } from '@prokopai/core/infrastructure/runtime/events';
import type { BroadcastFn, RuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import type { StorageBundle } from '@prokopai/core/infrastructure/storage/contracts';
import { executeChildSession } from '#agent/harnesses/prokop/subagent/child-session';
import { selfDelegationGuidance } from '#agent/harnesses/prokop/subagent/guidance';
import {
  resolveEffectiveSubagentTargets,
  type ResolveSubagentTargetsOptions,
} from '#agent/harnesses/prokop/subagent/policy';
import {
  buildTaskToolDefinition,
  canSpawnSubagent,
  canSpawnSubagentWithDeps,
  executeSubagent,
  executeSubagentWithDeps,
  getSubagentToolDefinition,
  readDelegationTarget,
  type GetSubagentToolDefinitionOptions,
  type SubagentInput,
  type SubagentServiceBroadcasts,
  type SubagentServiceDeps,
  type SubagentServiceSessionAccess,
} from '#agent/harnesses/prokop/subagent/task-tool';
import {
  buildDelegationCapabilities,
  type DelegationCatalog,
  type DelegationHostView,
} from '#agent/harnesses/prokop/subagent/delegation';
import { delegationHost } from '@prokopai/core/application/ports/delegation-host';
import { harnessProbes } from '@prokopai/core/application/ports/harness-probes';
import { getModelsConfig } from '@prokopai/core/config';
import { getDelegationMaxChildren } from '@prokopai/core/infrastructure/runtime/environment';
import { resolveModelId, resolveProviderId } from '@prokopai/core/infrastructure/providers/model-selection';
import { getPreconfigOrAgent, listSubagentPreconfigs } from '#agent/harnesses/prokop/context/sources';
import { getSession } from '@prokopai/core/infrastructure/storage/runtime';
import type { Session } from '@prokopai/sdk/types';
import {
  capekContextSourcesKey,
  capekRuntimeHostKey,
  capekStorageKey,
} from '#agent/harnesses/prokop/composition/plugins/service-keys';

/**
 * C5 subagent domain plugin. Owns the agent-scoped subagent service (depth
 * and ancestry policy over the captured storage and preconfig sources), the
 * `task` tool contribution through the generic contributed-domain-tool seam,
 * and the `self-delegation` context section. Composed payloads never read
 * module-level globals; the unscoped fallback keeps the pre-C5
 * execute-time module accessors and is installed explicitly, never at
 * module load.
 */

export const CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID = 'current.subagent-domain';
export const SUBAGENT_TOOL_CONTRIBUTION_ID = 'subagent.task';
export const DELEGATION_CAPABILITIES_CONTRIBUTION_ID = 'subagent.delegation-capabilities';
export const DELEGATION_CAPABILITIES_TOOL_NAME = 'delegation_capabilities';
/** Before session-search (700) so the contributed tool
 * order keeps `task` ahead of the workspace-gated domain tools, matching
 * the pre-C5 buildAiSdkTools phase-1 placement. */
export const SUBAGENT_TOOL_CONTRIBUTION_ORDER = 650;
export const SELF_DELEGATION_SECTION_ID = 'self-delegation';

export interface SubagentDomainService {
  readonly tools: readonly DomainToolPayload[];
  /** Depth gate shared by the task tool payload. */
  canSpawnSubagent(sessionId: string): Promise<boolean>;
  resolveTargets(options: ResolveSubagentTargetsOptions): Promise<Preconfig[]>;
  /** Whether the current session may delegate to a fresh instance of its own
   * preconfig: task tool visible + allowSelfAsSubagent + the resolved target
   * list contains the current preconfig. Mirrors the pre-C5 agent.ts
   * computation over the same domain policy. */
  selfDelegationAvailable(
    sessionId: string,
    preconfigId: string,
    allowSelfAsSubagent: boolean,
  ): Promise<boolean>;
  guidance(preconfigId: string): string;
}

export const capekSubagentDomainKey = serviceKey<SubagentDomainService>(
  'capek.subagent-domain',
  'agent',
);

function deliver(host: RuntimeHost, delivery: RuntimeDelivery): void {
  host.delivery.observe?.(delivery);
  host.delivery.emit(delivery);
}

/** Runtime-host delivery projection the subagent domain routes child
 * session events through. */
export function broadcastsFromHost(host: RuntimeHost): SubagentServiceBroadcasts {
  return {
    event: (event) => deliver(host, { event, audience: { scope: 'global' } }),
    sessionCreated: (session) =>
      deliver(host, { event: { kind: 'session', action: 'created', session }, audience: { scope: 'global' } }),
    sessionUpdated: (session) =>
      deliver(host, { event: { kind: 'session', action: 'updated', session }, audience: { scope: 'global' } }),
    toSession: (sessionId: string, event: RuntimeEvent) =>
      deliver(host, { event, audience: { scope: 'session', sessionId } }),
  };
}

interface TaskPayloadDeps {
  canSpawn: (sessionId: string) => boolean | Promise<boolean>;
  resolveDefinition: (
    options: GetSubagentToolDefinitionOptions,
  ) => Promise<ToolDefinition | null>;
  execute: (input: SubagentInput) => Promise<Record<string, unknown>>;
}

function taskPayload(deps: TaskPayloadDeps): DomainToolPayload {
  const placeholder = buildTaskToolDefinition([]);
  return {
    name: placeholder.name,
    description: placeholder.description,
    inputSchema: placeholder.inputSchema,
    display: { summary: '{description}' },
    visualize: (_input, result) => {
      const taskId = typeof result.task_id === 'string' ? result.task_id : '';
      const text = typeof result.result === 'string' ? result.result : '';
      return {
        type: 'none',
        badge: taskId ? 'session ready' : undefined,
        message: text.split('\n').filter((line) => line && !line.startsWith('task_id:'))
          .join('\n').replace(/<\/?task_result>/g, '').replace(/<\/?structured_result>/g, '').trim().slice(0, 200) || 'Subagent completed',
      };
    },
    isEnabled: async (workspaceId, sessionId) =>
      typeof sessionId === 'string' && await deps.canSpawn(sessionId),
    resolveDefinition: async (sessionId, options) => {
      const definition = await deps.resolveDefinition({
        sessionId,
        canSpawnSubagents: options?.canSpawnSubagents as boolean | string[] | null | undefined,
        allowSelfAsSubagent: options?.allowSelfAsSubagent as boolean | undefined,
      });
      if (!definition) return null;
      return {
        description: definition.description,
        inputSchema: definition.inputSchema,
      };
    },
    execute: async (input, context) => {
      const subagentInput: SubagentInput = {
        description: input.description as string,
        prompt: input.prompt as string,
        subagent_type: typeof input.subagent_type === 'string' && input.subagent_type ? input.subagent_type : undefined,
        target: readDelegationTarget(input.target),
        mode: input.mode === 'async' ? 'async' : 'wait',
        timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
        task_id: input.task_id as string | undefined,
        sessionId: context.sessionId,
        workspaceId: typeof context.workspaceId === 'string' ? context.workspaceId : undefined,
        workspacePath: typeof context.workspacePath === 'string' ? context.workspacePath : undefined,
        abortSignal: context.abortSignal as AbortSignal | undefined,
        onSessionCreated: context.onSessionCreated as ((childSessionId: string) => void | Promise<void>) | undefined,
        allowedSubagentIds: context.allowedSubagentIds as string[] | undefined,
        broadcast: context.broadcast as BroadcastFn | undefined,
        ...(input.outputSchema ? { outputSchema: input.outputSchema as Record<string, unknown> } : {}),
      };
      return deps.execute(subagentInput);
    },
  };
}

interface CapabilitiesPayloadDeps {
  canSpawn: (sessionId: string) => boolean | Promise<boolean>;
  getSession: (sessionId: string) => Session | null | Promise<Session | null>;
  getPreconfig: (id: string) => Promise<Preconfig | null>;
  listRoles: (sessionId: string, allowedSubagentIds?: string[]) => Promise<Preconfig[]>;
  host: () => DelegationHostView;
  catalog: () => DelegationCatalog;
  maxChildren: () => number;
}

/** The module-level catalog: Prokop models from the config, CLI models from the probes. */
export function moduleDelegationCatalog(): DelegationCatalog {
  return {
    prokopModels: () => getModelsConfig().providers.flatMap((provider) =>
      provider.models.map((model) => ({ id: model.id, name: model.name, providerId: provider.id }))),
    harnessModels: (harness) => harnessProbes().models(harness),
  };
}

/**
 * `delegation_capabilities`: the short picture a model needs before it
 * delegates. Visible wherever `task` is.
 */
export function capabilitiesPayload(deps: CapabilitiesPayloadDeps): DomainToolPayload {
  return {
    name: DELEGATION_CAPABILITIES_TOOL_NAME,
    description: 'What you can delegate to: your roles (subagent types) with their pinned harness and model, the harnesses '
      + 'enabled on this machine with a short list of their models, which targets you may name without a role, and the '
      + 'limits. Call it before using a target on the task tool. Pass search to find models beyond the short lists.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Filter models by id or name (case-insensitive).' },
      },
    },
    display: { summary: 'delegation capabilities' },
    isEnabled: async (_workspaceId, sessionId) => typeof sessionId === 'string' && await deps.canSpawn(sessionId),
    execute: async (input, context) => {
      const session = await deps.getSession(context.sessionId);
      const parentPreconfig = session?.preconfigId ? await deps.getPreconfig(session.preconfigId) : null;
      const roles = await deps.listRoles(context.sessionId, context.allowedSubagentIds as string[] | undefined);
      const capabilities = await buildDelegationCapabilities({
        roles,
        caller: {
          harness: session?.harness ?? 'prokop',
          model: session ? resolveModelId(session, parentPreconfig) : null,
          provider: session ? resolveProviderId(session, parentPreconfig) : null,
        },
        parentPreconfig,
        host: deps.host(),
        catalog: deps.catalog(),
        limits: { depth: 2, maxChildren: deps.maxChildren() },
        search: typeof input.search === 'string' ? input.search : undefined,
      });
      return capabilities as unknown as Record<string, unknown>;
    },
  };
}

/** Unscoped compatibility payload: keeps the pre-C5 execute-time module
 * accessors. Installed through `installTaskToolFallback`, never at module
 * load. */
export function createTaskToolFallbackPayload(): DomainToolPayload {
  return taskPayload({
    canSpawn: (sessionId) => canSpawnSubagent(sessionId),
    resolveDefinition: (options) => getSubagentToolDefinition(options),
    execute: async (input) => executeSubagent(input) as unknown as Record<string, unknown>,
  });
}

export function createCapabilitiesFallbackPayload(): DomainToolPayload {
  return capabilitiesPayload({
    canSpawn: (sessionId) => canSpawnSubagent(sessionId),
    getSession,
    getPreconfig: getPreconfigOrAgent,
    listRoles: async (sessionId, allowedSubagentIds) => {
      const session = await getSession(sessionId);
      const preconfig = session?.preconfigId ? await getPreconfigOrAgent(session.preconfigId) : null;
      return resolveEffectiveSubagentTargets({
        sessionId,
        canSpawnSubagents: allowedSubagentIds ?? preconfig?.canSpawnSubagents ?? true,
        allowSelfAsSubagent: preconfig?.allowSelfAsSubagent,
      }, { getSession, listPreconfigs: listSubagentPreconfigs });
    },
    host: delegationHost,
    catalog: moduleDelegationCatalog,
    maxChildren: getDelegationMaxChildren,
  });
}

/** Explicitly installs the unscoped legacy fallback. Called by the Jean2
 * compatibility bindings installation (server bootstrap) and by focused
 * tests; no module-load registration exists. */
export function installTaskToolFallback(): void {
  registerDomainToolFallback('task', createTaskToolFallbackPayload());
  registerDomainToolFallback(DELEGATION_CAPABILITIES_TOOL_NAME, createCapabilitiesFallbackPayload());
}

type GuidanceSectionContribution = ContextSectionContribution<ContextAssemblyData>;

export function subagentDomainPlugin(id: string): RuntimePlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekSubagentDomainKey],
    requires: [capekStorageKey, capekContextSourcesKey, capekRuntimeHostKey],
    setup(context: PluginContext) {
      const storage: StorageBundle = context.require(capekStorageKey);
      const contextSources = context.require(capekContextSourcesKey);
      const host: RuntimeHost = context.require(capekRuntimeHostKey);
      const preconfigSource = contextSources.preconfigs;
      const getPreconfigOrAgentScoped = (preconfigId: string): Promise<Preconfig | null> =>
        preconfigSource ? preconfigSource.getForAgent(preconfigId) : Promise.resolve(null);
      const listSubagentPreconfigsScoped = (): Promise<Preconfig[]> =>
        preconfigSource ? preconfigSource.listSubagents() : Promise.resolve([]);

      const sessionAccess: SubagentServiceSessionAccess = {
        getSession: async (sessionId) => storage.conversation.getSession(sessionId),
        createSession: async (session) => storage.conversation.createSession(session),
        updateSession: async (sessionId, updates) => storage.conversation.updateSession(sessionId, updates),
        getWorkspaceAutoApproveSeverity: async (workspaceId) => storage.workspaces.getAutoApproveSeverity?.(workspaceId),
      };

      sessionAccess.listChildSessions = async (parentId) => storage.conversation.getChildSessions(parentId);
      const serviceDeps: SubagentServiceDeps = {
        sessionAccess,
        preconfigs: {
          getPreconfigOrAgent: getPreconfigOrAgentScoped,
          listSubagentPreconfigs: listSubagentPreconfigsScoped,
        },
        broadcasts: broadcastsFromHost(host),
        executeChild: executeChildSession,
        host: delegationHost(),
        catalog: moduleDelegationCatalog(),
        maxChildren: getDelegationMaxChildren,
      };
      const listRolesScoped = async (sessionId: string, allowedSubagentIds?: string[]): Promise<Preconfig[]> => {
        const session = await sessionAccess.getSession(sessionId);
        const preconfig = session?.preconfigId ? await getPreconfigOrAgentScoped(session.preconfigId) : null;
        return resolveEffectiveSubagentTargets({
          sessionId,
          canSpawnSubagents: allowedSubagentIds ?? preconfig?.canSpawnSubagents ?? true,
          allowSelfAsSubagent: preconfig?.allowSelfAsSubagent,
          maximumDepthReached: !(await canSpawnSubagentWithDeps(sessionId, sessionAccess.getSession)),
        }, { getSession: sessionAccess.getSession, listPreconfigs: listSubagentPreconfigsScoped });
      };

      const service: SubagentDomainService = {
        tools: [
          taskPayload({
            canSpawn: async (sessionId) => canSpawnSubagentWithDeps(sessionId, sessionAccess.getSession),
            resolveDefinition: async (options) => {
              // The composed path resolves targets through the scope-captured
              // storage and preconfig sources; it never reads module globals.
              const deps = {
                getSession: sessionAccess.getSession,
                listPreconfigs: listSubagentPreconfigsScoped,
              };
              const maximumDepthReached = !(await canSpawnSubagentWithDeps(options.sessionId, deps.getSession));
              return resolveEffectiveSubagentTargets({
                ...options,
                maximumDepthReached,
              }, deps).then((targets) =>
                targets.length === 0 ? null : buildTaskToolDefinition(targets));
            },
            execute: (input) => executeSubagentWithDeps(input, serviceDeps) as unknown as Promise<Record<string, unknown>>,
          }),
          capabilitiesPayload({
            canSpawn: async (sessionId) => canSpawnSubagentWithDeps(sessionId, sessionAccess.getSession),
            getSession: sessionAccess.getSession,
            getPreconfig: getPreconfigOrAgentScoped,
            listRoles: listRolesScoped,
            host: delegationHost,
            catalog: moduleDelegationCatalog,
            maxChildren: getDelegationMaxChildren,
          }),
        ],
        canSpawnSubagent: async (sessionId) => canSpawnSubagentWithDeps(sessionId, sessionAccess.getSession),
        resolveTargets: (options) => resolveEffectiveSubagentTargets(options, {
          getSession: sessionAccess.getSession,
          listPreconfigs: listSubagentPreconfigsScoped,
        }),
        selfDelegationAvailable: async (sessionId, preconfigId, allowSelfAsSubagent) =>
          resolveEffectiveSubagentTargets({
            sessionId,
            canSpawnSubagents: true,
            allowSelfAsSubagent,
            maximumDepthReached: !(await canSpawnSubagentWithDeps(sessionId, sessionAccess.getSession)),
          }, {
            getSession: sessionAccess.getSession,
            listPreconfigs: listSubagentPreconfigsScoped,
          }).then((targets) =>
            allowSelfAsSubagent === true && targets.some((candidate) => candidate.id === preconfigId)),
        guidance: selfDelegationGuidance,
      };

      const guidance: GuidanceSectionContribution = {
        id: SELF_DELEGATION_SECTION_ID,
        phase: 'identity',
        order: 50,
        provide: (build) => {
          const data = validateContextAssemblyData(build.data);
          return data.selfDelegationAvailable ? service.guidance(data.preconfig.id) : null;
        },
      };

      context.provide(capekSubagentDomainKey, service);
      context.contributeTool({
        id: SUBAGENT_TOOL_CONTRIBUTION_ID,
        order: SUBAGENT_TOOL_CONTRIBUTION_ORDER,
        definition: {
          name: service.tools[0].name,
          description: service.tools[0].description,
          inputSchema: service.tools[0].inputSchema,
          timeout: null,
          [DOMAIN_TOOL_PAYLOAD_FIELD]: service.tools[0],
        } as KernelToolDefinition,
        requiredCapabilities: [capekSubagentDomainKey],
      });
      context.contributeTool({
        id: DELEGATION_CAPABILITIES_CONTRIBUTION_ID,
        order: SUBAGENT_TOOL_CONTRIBUTION_ORDER + 1,
        definition: {
          name: service.tools[1].name,
          description: service.tools[1].description,
          inputSchema: service.tools[1].inputSchema,
          [DOMAIN_TOOL_PAYLOAD_FIELD]: service.tools[1],
        } as KernelToolDefinition,
        requiredCapabilities: [capekSubagentDomainKey],
      });
      context.contributeContext(guidance);
    },
  };
}
