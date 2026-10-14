import type { AgentHandlers } from '@prokopai/agent-protocol';
import type { HarnessProbePort } from '@prokopai/core/application/ports/harness-probes';
import { listCachedClaudeModels, readCachedClaudeUsageLimits, readClaudeSessionTitle } from '@/harnesses/claude-cli';
import { listCachedCodexModels, readCachedCodexUsageLimits } from '@/harnesses/codex-cli';

/** The probes as the agent runs them. */
export const localHarnessProbes: HarnessProbePort = {
  models: harness => harness === 'codex-cli' ? listCachedCodexModels() : listCachedClaudeModels(),
  usageLimits: harness => harness === 'codex-cli' ? readCachedCodexUsageLimits() : readCachedClaudeUsageLimits(),
  nativeTitle: sessionId => readClaudeSessionTitle(sessionId),
};

function cliHarness(harness: string): 'codex-cli' | 'claude-cli' {
  if (harness !== 'codex-cli' && harness !== 'claude-cli') throw new Error(`${harness} has no CLI probes`);
  return harness;
}

/** Agent side of `models.list`, `usage.limits` and `title.native`. */
export const probeHandlers: AgentHandlers = {
  'models.list': async ({ harness }) => ({
    models: await localHarnessProbes.models(cliHarness(harness)) as unknown as Array<Record<string, unknown>>,
  }),
  'usage.limits': async ({ harness }) =>
    await localHarnessProbes.usageLimits(cliHarness(harness)) as unknown as Record<string, unknown>,
  'title.native': async ({ sessionId }) => ({ title: await localHarnessProbes.nativeTitle(sessionId) }),
};
