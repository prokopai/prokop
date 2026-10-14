import type { SessionHarness } from '@prokopai/sdk';
import type { HarnessExecutor, HarnessRegistration } from '@prokopai/core/application/sessions/harness-execution';
import { harnessCapabilities } from './capabilities';
import type { HarnessRegistrationDeps } from './harnesses/deps';

export type { HarnessRegistrationDeps };

type HarnessModules = {
  prokop: typeof import('./harnesses/prokop');
  'codex-cli': typeof import('./harnesses/codex-cli');
  'claude-cli': typeof import('./harnesses/claude-cli');
};

/** Builds one harness now, loading its runtime. */
export function createHarnessRegistration(harness: SessionHarness, deps: HarnessRegistrationDeps): HarnessRegistration {
  switch (harness) {
    case 'prokop':
      return (require('./harnesses/prokop') as HarnessModules['prokop']).createProkopRegistration();
    case 'codex-cli':
      return (require('./harnesses/codex-cli') as HarnessModules['codex-cli']).createCodexRegistration(deps);
    case 'claude-cli':
      return (require('./harnesses/claude-cli') as HarnessModules['claude-cli']).createClaudeRegistration(deps);
  }
}

/**
 * A registration whose harness loads on its first call (host/agent split,
 * Phase 2.6b): a Prokop-only user never loads the Claude Agent SDK, and an
 * idle agent process loads none of them. Its shape comes from
 * `harnessCapabilities`, like the host's routing registrations.
 */
function lazyRegistration(harness: SessionHarness, deps: HarnessRegistrationDeps): HarnessRegistration {
  let loaded: HarnessRegistration | null = null;
  const load = (): HarnessRegistration => {
    if (!loaded) {
      deps.prepare?.[harness]?.();
      loaded = createHarnessRegistration(harness, deps);
    }
    return loaded;
  };
  const forward = (operation: string) => (...args: unknown[]): unknown =>
    (load().execution as unknown as Record<string, (...a: unknown[]) => unknown>)[operation]!(...args);
  const capabilities = harnessCapabilities[harness];
  const execution: Record<string, unknown> = {
    sendMessage: forward('sendMessage'),
    interruptSession: forward('interruptSession'),
    // Nothing of this harness runs before it loads.
    isSessionActive: (sessionId: string) => loaded?.execution.isSessionActive(sessionId) ?? false,
  };
  for (const operation of capabilities.operations) execution[operation] = forward(operation);
  return {
    execution: execution as unknown as HarnessExecutor,
    ...(capabilities.headless ? { headless: (...args: Parameters<NonNullable<HarnessRegistration['headless']>>) => load().headless!(...args) } : {}),
    ...('hostOperations' in capabilities ? { hostOperations: [...capabilities.hostOperations] } : {}),
  };
}

/**
 * The three harness registrations, built the same way in the host (which
 * routes to them, forwarded under the agent protocol) and in the agent
 * process (which runs them). CLI title regeneration is a host operation
 * (`hostOperations`); the agent process passes a stand-in it never calls.
 */
export function createHarnessRegistrations(deps: HarnessRegistrationDeps): Record<SessionHarness, HarnessRegistration> {
  return Object.fromEntries(Object.keys(harnessCapabilities)
    .map(harness => [harness, lazyRegistration(harness as SessionHarness, deps)])) as Record<SessionHarness, HarnessRegistration>;
}
