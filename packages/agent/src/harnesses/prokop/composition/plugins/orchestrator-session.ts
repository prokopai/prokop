import type { RuntimePlugin, PluginContext } from '#agent/harnesses/prokop/composition/kernel/types';
import { runOrchestratorSession } from '#agent/harnesses/prokop/goals/orchestrator-session';
import {
  capekOrchestratorSessionKey,
  type OrchestratorSessionContract,
} from '#agent/harnesses/prokop/composition/plugins/service-keys';

/**
 * Provider for the goals orchestrator model-turn contract
 * (`capek.orchestrator-session`). Wraps the implementation at
 * `goals/orchestrator-session.ts` with its exact function identity, so the
 * goal evaluator consumes the named service instead of importing it.
 */
export function orchestratorSessionProviderPlugin(id: string): RuntimePlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekOrchestratorSessionKey],
    setup(context: PluginContext) {
      const contract: OrchestratorSessionContract = {
        run: runOrchestratorSession,
      };
      context.provide(capekOrchestratorSessionKey, contract);
    },
  };
}
