import type { HostHandlers } from '@prokopai/agent-protocol';
import type { HarnessAskStore } from '@/infrastructure/runtime/harness-asks';
import type { CreateGrantParams } from '@/infrastructure/runtime/host';

/**
 * Host side of the harness ask store: the two `interaction.*` requests only
 * Claude Code and Codex need. Pending-ask rows and grant matching use the
 * shared `interaction.*` handlers (`host-runtime.ts`).
 */
export function createHarnessAskHandlers(store: HarnessAskStore): HostHandlers {
  return {
    'interaction.resolveWithGrant': ({ requestId, status, resolution, grant }) =>
      store.resolveRequest(requestId, status, resolution, grant as CreateGrantParams | undefined),
    'interaction.control': ({ sessionId }) => store.sessionControl(sessionId),
  };
}
