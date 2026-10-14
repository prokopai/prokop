import type { SessionHarness } from '@prokopai/sdk';
import type { AgentsApplication } from '@prokopai/core/application/agents';
import type { SessionExecutionPort } from '@prokopai/core/application/ports/execution';
import { listPreconfigs } from '@prokopai/core/infrastructure/config/preconfig';

/** What every harness registration is built from. */
export interface HarnessRegistrationDeps {
  agents: Pick<AgentsApplication, 'getPreconfigOrAgent' | 'getAgentDirectory' | 'readAgentMemoryFile'>;
  titles: Record<'codex-cli' | 'claude-cli', SessionExecutionPort['regenerateTitle']>;
  /** Runs once, right before a harness's runtime loads (the agent process installs Prokop's process defaults). */
  prepare?: Partial<Record<SessionHarness, () => void>>;
}

/** Preconfig and agent instructions the Claude Code and Codex drivers read. */
export function harnessInstructions(agents: HarnessRegistrationDeps['agents']) {
  return {
    listPreconfigs,
    getPreconfig: (id: string) => agents.getPreconfigOrAgent(id),
    getAgentDirectory: (id: string) => agents.getAgentDirectory(id),
    readAgentMemoryFile: (id: string, filename: 'MEMORY.md' | 'USER.md') => agents.readAgentMemoryFile(id, filename),
  };
}
