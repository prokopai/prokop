import type { CodexModel, HarnessUsageLimits } from '@prokopai/sdk';

export type CliHarness = 'codex-cli' | 'claude-cli';

/**
 * Reads the agent answers for the native CLI harnesses: cached model
 * catalogs, plan usage limits and the title Claude Code wrote itself. CLI
 * availability and version stay host probes: the host needs them before any
 * harness loads (harness list, session creation).
 */
export interface HarnessProbePort {
  models(harness: CliHarness): Promise<CodexModel[]>;
  usageLimits(harness: CliHarness): Promise<HarnessUsageLimits>;
  nativeTitle(sessionId: string): Promise<string | null>;
}

let current: HarnessProbePort | null = null;

export function configureHarnessProbes(port: HarnessProbePort): void {
  current = port;
}

export function harnessProbes(): HarnessProbePort {
  if (!current) throw new Error('Harness probes are not configured');
  return current;
}
