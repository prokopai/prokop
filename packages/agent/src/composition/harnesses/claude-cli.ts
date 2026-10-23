import { harnessMcpTools } from '@prokopai/core/application/ports/mcp-tools';
import type { HarnessRegistration } from '@prokopai/core/application/sessions/harness-execution';
import { createClaudeCliHarness, createClaudeExecution } from '#agent/harnesses/claude-cli/index';
import { agentSkillsDomainTools, memoryDomainTools, sessionSearchDomainTools } from '#agent/harnesses/shared/domain-tools';
import { harnessInstructions, type HarnessRegistrationDeps } from './deps';

/** The Claude Code driver (Claude Agent SDK, MCP SDK). */
export function createClaudeRegistration(deps: HarnessRegistrationDeps): HarnessRegistration {
  const execution = createClaudeExecution({
    mcp: { tools: (path, sessionId) => harnessMcpTools().tools(path, sessionId) },
    instructions: harnessInstructions(deps.agents),
    memoryTools: memoryDomainTools,
    sessionSearch: sessionSearchDomainTools,
    agentSkills: agentSkillsDomainTools,
  });
  return createClaudeCliHarness(execution, deps.titles['claude-cli']);
}
