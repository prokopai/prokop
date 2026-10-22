import { harnessMcpTools } from '@prokopai/core/application/ports/mcp-tools';
import type { HarnessRegistration } from '@prokopai/core/application/sessions/harness-execution';
import { codexCliVersion, createCodexCliHarness, createCodexExecution } from '#agent/harnesses/codex-cli/index';
import { spawnCodexAppServer } from '#agent/harnesses/codex-cli/app-server';
import { createPretoolChannel } from '#agent/harnesses/codex-cli/pretool-hook';
import { agentSkillsDomainTools, delegationDomainTools, memoryDomainTools, sessionSearchDomainTools } from '#agent/harnesses/shared/domain-tools';
import { harnessInstructions, type HarnessRegistrationDeps } from './deps';

/** The Codex app-server driver. */
export function createCodexRegistration(deps: HarnessRegistrationDeps): HarnessRegistration {
  const execution = createCodexExecution({
    mcp: { tools: (path, sessionId) => harnessMcpTools().tools(path, sessionId) },
    connect: spawnCodexAppServer,
    version: codexCliVersion,
    prepareHook: createPretoolChannel,
    memoryTools: memoryDomainTools,
    sessionSearch: sessionSearchDomainTools,
    agentSkills: agentSkillsDomainTools,
    delegation: delegationDomainTools,
    instructions: harnessInstructions(deps.agents),
  });
  return createCodexCliHarness(execution, deps.titles['codex-cli']);
}
