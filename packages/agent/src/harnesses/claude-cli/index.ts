import type { HarnessRegistration } from '@prokopai/core/application/sessions/harness-execution';
import type { SessionExecutionPort } from '@prokopai/core/application/ports/execution';
import { runHeadlessTurn } from '@prokopai/core/application/ports/headless-execution';

export { createClaudeExecution } from './execution';
export { claudeCliAvailable, claudeCliVersion } from './version';
export { listClaudeModels, listCachedClaudeModels, getClaudeModelSelection } from './models';
export { readCachedClaudeUsageLimits } from './usage-limits';
export { readClaudeSessionTitle } from './title';

/** Claude CLI owns turns and model choice; titles use the universal
 * server-side regeneration supplied by the composition root, which falls
 * back to the CLI's own title (readClaudeSessionTitle). */
export function createClaudeCliHarness(
  execution: Pick<SessionExecutionPort, 'sendMessage' | 'drainQueue' | 'steerQueue' | 'interruptSession' | 'isSessionActive' | 'compact' | 'editMessage' | 'revert' | 'fork'>,
  regenerateTitle: SessionExecutionPort['regenerateTitle'],
): HarnessRegistration {
  return {
    execution: {
      ...execution,
      regenerateTitle,
    },
    // Headless child runs (scheduled jobs, learning reviews, delegated
    // children) drive a normal turn; sendMessage resolves at turn completion.
    // A visible run passes the dispatcher's wire so clients follow the child.
    headless: (input, options) => runHeadlessTurn(execution.sendMessage, input, options),
  };
}
