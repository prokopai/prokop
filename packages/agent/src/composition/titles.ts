import type { SessionExecutionPort } from '@prokopai/core/application/ports/execution';
import { createSessionTitleRegeneration } from '@prokopai/core/application/sessions/title';
import { fallbackSessionTitle } from '@prokopai/core/infrastructure/session-title';
import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { readClaudeSessionTitle } from '#agent/harnesses/claude-cli/title';
import { prokopTitleBindings } from '#agent/harnesses/prokop/bindings/titles';

/**
 * CLI title regeneration in the agent process: the same universal rules the
 * host applies in process, over the agent's storage port. The title model
 * runs here, so the host never loads the AI SDK for titles.
 */
export function createAgentTitleRegeneration(): Record<'codex-cli' | 'claude-cli', SessionExecutionPort['regenerateTitle']> {
  const conversation = () => getStorage().conversation;
  const deps = {
    repository: {
      getSession: (id: string) => conversation().getSession(id),
      updateSession: (id: string, updates: Parameters<ReturnType<typeof conversation>['updateSession']>[1]) =>
        conversation().updateSession(id, updates),
      listLatestMessagesWithPartsPage: (sessionId: string, limit?: number) =>
        conversation().listLatestMessagesWithPartsPage(sessionId, limit),
    },
    titles: { ...prokopTitleBindings, fallbackSessionTitle },
  };
  return {
    'codex-cli': createSessionTitleRegeneration(deps),
    'claude-cli': createSessionTitleRegeneration({ ...deps, harnessTitle: readClaudeSessionTitle }),
  };
}
