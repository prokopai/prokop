import { getHarnessNotificationPort } from '@prokopai/core/application/ports/harness-notifications';
import type { HarnessRegistration } from '@prokopai/core/application/sessions/harness-execution';
import { createProkopHarness } from '#agent/harnesses/prokop/index';

/** The Prokop runtime (AI SDK, built-in tools, plugins). */
export function createProkopRegistration(): HarnessRegistration {
  return createProkopHarness({
    onSessionChanged: (changedSession) => {
      if (changedSession.workspaceRootId) {
        getHarnessNotificationPort()?.notifyWorktreeChanged?.(changedSession.workspaceRootId);
      }
    },
  });
}
