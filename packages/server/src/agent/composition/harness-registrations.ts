import type { SessionHarness } from '@prokopai/sdk';
import type { AgentsApplication } from '@prokopai/core/application/agents';
import type { SessionExecutionPort } from '@prokopai/core/application/ports/execution';
import { getHarnessNotificationPort } from '@prokopai/core/application/ports/harness-notifications';
import { harnessMcpTools } from '@prokopai/core/application/ports/mcp-tools';
import type { HarnessRegistration } from '@prokopai/core/application/sessions/harness-execution';
import { createClaudeCliHarness, createClaudeExecution } from '@/harnesses/claude-cli';
import { codexCliVersion, createCodexCliHarness, createCodexExecution } from '@/harnesses/codex-cli';
import { spawnCodexAppServer } from '@/harnesses/codex-cli/app-server';
import { createPretoolChannel } from '@/harnesses/codex-cli/pretool-hook';
import { createProkopHarness } from '@/harnesses/prokop';
import { agentSkillsDomainTools, memoryDomainTools, sessionSearchDomainTools } from '@/harnesses/shared/domain-tools';
import { listPreconfigs } from '@prokopai/core/infrastructure/config/preconfig';

/**
 * The three harness registrations, built the same way in the host (which
 * routes to them, forwarded under the agent protocol) and in the agent
 * process (which runs them). CLI title regeneration is a host operation
 * (`hostOperations`); the agent process passes a stand-in it never calls.
 */
export function createHarnessRegistrations(deps: {
  agents: Pick<AgentsApplication, 'getPreconfigOrAgent' | 'getAgentDirectory' | 'readAgentMemoryFile'>;
  titles: Record<'codex-cli' | 'claude-cli', SessionExecutionPort['regenerateTitle']>;
}): Record<SessionHarness, HarnessRegistration> {
  const instructions = {
    listPreconfigs,
    getPreconfig: (id: string) => deps.agents.getPreconfigOrAgent(id),
    getAgentDirectory: (id: string) => deps.agents.getAgentDirectory(id),
    readAgentMemoryFile: (id: string, filename: 'MEMORY.md' | 'USER.md') => deps.agents.readAgentMemoryFile(id, filename),
  };
  const codexExecution = createCodexExecution({
    mcp: { tools: (path, sessionId) => harnessMcpTools().tools(path, sessionId) },
    connect: spawnCodexAppServer,
    version: codexCliVersion,
    prepareHook: createPretoolChannel,
    memoryTools: memoryDomainTools,
    sessionSearch: sessionSearchDomainTools,
    agentSkills: agentSkillsDomainTools,
    instructions,
  });
  const claudeExecution = createClaudeExecution({
    mcp: { tools: (path, sessionId) => harnessMcpTools().tools(path, sessionId) },
    instructions,
    memoryTools: memoryDomainTools,
    sessionSearch: sessionSearchDomainTools,
    agentSkills: agentSkillsDomainTools,
  });
  return {
    prokop: createProkopHarness({
      onSessionChanged: (changedSession) => {
        if (changedSession.workspaceRootId) {
          getHarnessNotificationPort()?.notifyWorktreeChanged?.(changedSession.workspaceRootId);
        }
      },
    }),
    'codex-cli': createCodexCliHarness(codexExecution, deps.titles['codex-cli']),
    'claude-cli': createClaudeCliHarness(claudeExecution, deps.titles['claude-cli']),
  };
}
