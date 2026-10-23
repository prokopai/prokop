import type { Preconfig } from '@prokopai/sdk/types'
import { validateContextAssemblyData, type ContextAssemblyData } from '#agent/harnesses/prokop/context/assembler';
import { serviceKey } from '#agent/harnesses/prokop/composition/kernel/service-key';
import type {
  RuntimePlugin,
  ContextSectionContribution,
  PluginContext,
} from '#agent/harnesses/prokop/composition/kernel/types';
import type { StorageBundle } from '@prokopai/core/infrastructure/storage/contracts';
import { selfDelegationGuidance } from '#agent/harnesses/prokop/subagent/guidance';
import { delegationGuidance, PROKOP_DELEGATION_CALL } from '#agent/harnesses/shared/delegation-guidance';
import { messagingGuidance, PROKOP_MESSAGING_CALL } from '#agent/harnesses/shared/messaging-guidance';
import {
  resolveEffectiveSubagentTargets,
  type ResolveSubagentTargetsOptions,
} from '#agent/harnesses/prokop/subagent/policy';
import {
  canSpawnSubagentWithDeps,
  type SubagentServiceSessionAccess,
} from '#agent/harnesses/prokop/subagent/task-tool';
import {
  capekContextSourcesKey,
  capekStorageKey,
} from '#agent/harnesses/prokop/composition/plugins/service-keys';

/**
 * C5 subagent domain plugin. Owns the agent-scoped subagent policy (depth
 * and ancestry over the captured storage and preconfig sources) and the
 * `self-delegation` context section. The delegation tools themselves are
 * runtime tools (`composition/runtime-tools.ts`), reaching a Prokop session
 * through the workspace tool list like every other harness.
 */

export const CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID = 'current.subagent-domain';
export const DELEGATION_SECTION_ID = 'delegation';
export const MESSAGING_SECTION_ID = 'messaging';
export const SELF_DELEGATION_SECTION_ID = 'self-delegation';

export interface SubagentDomainService {
  /** Depth gate. */
  canSpawnSubagent(sessionId: string): Promise<boolean>;
  resolveTargets(options: ResolveSubagentTargetsOptions): Promise<Preconfig[]>;
  /** Whether the current session may delegate to a fresh instance of its own
   * preconfig: allowSelfAsSubagent + the resolved target list contains the
   * current preconfig. */
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

type GuidanceSectionContribution = ContextSectionContribution<ContextAssemblyData>;

export function subagentDomainPlugin(id: string): RuntimePlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekSubagentDomainKey],
    requires: [capekStorageKey, capekContextSourcesKey],
    setup(context: PluginContext) {
      const storage: StorageBundle = context.require(capekStorageKey);
      const contextSources = context.require(capekContextSourcesKey);
      const preconfigSource = contextSources.preconfigs;
      const listSubagentPreconfigsScoped = (): Promise<Preconfig[]> =>
        preconfigSource ? preconfigSource.listSubagents() : Promise.resolve([]);

      const sessionAccess: SubagentServiceSessionAccess = {
        getSession: async (sessionId) => storage.conversation.getSession(sessionId),
        createSession: async (session) => storage.conversation.createSession(session),
        updateSession: async (sessionId, updates) => storage.conversation.updateSession(sessionId, updates),
        getWorkspaceAutoApproveSeverity: async (workspaceId) => storage.workspaces.getAutoApproveSeverity?.(workspaceId),
      };

      const service: SubagentDomainService = {
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

      // The shared delegation paragraph, when the session's tool list has delegate_task.
      const delegation: GuidanceSectionContribution = {
        id: DELEGATION_SECTION_ID,
        phase: 'identity',
        order: 45,
        provide: (build) => {
          const data = validateContextAssemblyData(build.data);
          return data.delegationAvailable ? delegationGuidance(PROKOP_DELEGATION_CALL, false) : null;
        },
      };
      // The shared messaging paragraph, when the session's tool list has message_agent.
      const messaging: GuidanceSectionContribution = {
        id: MESSAGING_SECTION_ID,
        phase: 'identity',
        order: 46,
        provide: (build) => {
          const data = validateContextAssemblyData(build.data);
          return data.messagingAvailable ? messagingGuidance(PROKOP_MESSAGING_CALL, false) : null;
        },
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
      context.contributeContext(delegation);
      context.contributeContext(messaging);
      context.contributeContext(guidance);
    },
  };
}
