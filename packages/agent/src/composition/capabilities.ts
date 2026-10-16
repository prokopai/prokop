import type { SessionHarness } from '@prokopai/sdk';
import type { HarnessOperation } from '@prokopai/core/application/sessions/harness-execution';

export type OptionalHarnessOperation = HarnessOperation | 'drainQueue' | 'steerQueue';

/**
 * What each harness supports beyond sending, interrupting and reporting
 * activity. The lazy registrations take their shape from it, so a harness
 * loads only on its first call (`harness-capabilities.test.ts` checks it
 * against the real registrations).
 */
export const harnessCapabilities = {
  prokop: { operations: ['editMessage', 'regenerateTitle', 'compact', 'revert', 'fork'], headless: true },
  'codex-cli': {
    operations: ['editMessage', 'regenerateTitle', 'compact', 'revert', 'fork', 'drainQueue', 'steerQueue'], headless: true,
  },
  'claude-cli': {
    operations: ['editMessage', 'regenerateTitle', 'compact', 'revert', 'fork', 'drainQueue', 'steerQueue'], headless: true,
  },
} as const satisfies Record<SessionHarness, { operations: readonly OptionalHarnessOperation[]; headless: boolean }>;
