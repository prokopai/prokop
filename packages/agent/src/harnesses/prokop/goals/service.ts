import { AsyncLocalStorage } from 'node:async_hooks';
import type { evaluateGoal, EvaluateGoalOptions } from '#agent/harnesses/prokop/goals/evaluator';
import type { GoalLoopOptions } from '#agent/harnesses/prokop/goals/loop';

/**
 * Goal domain service access. The composed agent scope seeds the plugin
 * service here through `enterAgentScope` (when the goal domain plugin is
 * installed); consumers resolve the active service through `getGoalDomain()`.
 * Unscoped consumers keep the pre-adoption module path (module storage,
 * module broadcast, module evaluator) as the fallback, exactly like the C6
 * policy accessors.
 */

export interface GoalDomainService {
  evaluateGoal(options: EvaluateGoalOptions): ReturnType<typeof evaluateGoal>;
  runGoalLoop(options: GoalLoopOptions): Promise<void>;
}

const scopedService = new AsyncLocalStorage<GoalDomainService>();

/** The module path loads on use: scope entry (`compose.ts`) imports this file. */
function unscopedGoalDomain(): GoalDomainService {
  return {
    evaluateGoal: (options) =>
      (require('#agent/harnesses/prokop/goals/evaluator') as typeof import('#agent/harnesses/prokop/goals/evaluator'))
        .evaluateGoal(options),
    runGoalLoop: (options) =>
      (require('#agent/harnesses/prokop/goals/loop') as typeof import('#agent/harnesses/prokop/goals/loop'))
        .runGoalLoop(options),
  };
}

/** Resolves the scoped goal domain service, or the unscoped module-path
 * fallback outside a composed agent scope. */
export function getGoalDomain(): GoalDomainService {
  return scopedService.getStore() ?? unscopedGoalDomain();
}

/** Seeds a service for the callback duration. `enterAgentScope` seeds the
 * composed agent scope's service here when the goal domain plugin is
 * installed. */
export function withGoalDomain<T>(service: GoalDomainService, callback: () => T): T {
  return scopedService.run(service, callback);
}
