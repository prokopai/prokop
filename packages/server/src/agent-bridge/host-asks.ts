import type { HostHandlers } from '@prokopai/agent-protocol';
import type { HarnessAskStore } from '@prokopai/core/infrastructure/runtime/harness-asks';
import type { CreateGrantParams } from '@prokopai/core/infrastructure/runtime/host';
import type { AgentAskPort } from '@prokopai/core/application/ports/agent-asks';

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

/**
 * The host's ask port across the protocol: every lookup and answer is a
 * request to the agent. Liveness of native waiters comes from the host's own
 * record of what the connected agent opened (`hasLiveRequest`).
 */
export function protocolAgentAsks(request: {
  lookup(toolCallId: string, requestId?: string): ReturnType<AgentAskPort['lookup']>;
  resolve(answer: Parameters<AgentAskPort['resolve']>[0]): Promise<boolean>;
  hasLiveRequest(requestId: string): boolean;
}): AgentAskPort {
  return { lookup: request.lookup, resolve: request.resolve, hasLiveRequest: request.hasLiveRequest };
}
