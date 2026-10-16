import type { HarnessProbePort } from '@prokopai/core/application/ports/harness-probes';
import { readClaudeSessionTitle } from '#agent/harnesses/claude-cli/title';
import { listCachedCodexModels } from '#agent/harnesses/codex-cli/models';
import { readCachedCodexUsageLimits } from '#agent/harnesses/codex-cli/usage-limits';

/** The Claude readers use the Claude Agent SDK, which loads on the first Claude probe. */
const claudeModels = () => require('#agent/harnesses/claude-cli/models') as typeof import('#agent/harnesses/claude-cli/models');
const claudeUsage = () =>
  require('#agent/harnesses/claude-cli/usage-limits') as typeof import('#agent/harnesses/claude-cli/usage-limits');

/** The CLI harness probes: models, usage limits and Claude's native title. */
export const localHarnessProbes: HarnessProbePort = {
  models: harness => harness === 'codex-cli' ? listCachedCodexModels() : claudeModels().listCachedClaudeModels(),
  usageLimits: harness => harness === 'codex-cli' ? readCachedCodexUsageLimits() : claudeUsage().readCachedClaudeUsageLimits(),
  nativeTitle: sessionId => readClaudeSessionTitle(sessionId),
};
