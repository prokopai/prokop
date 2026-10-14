import type { AgentEndpoint } from '@prokopai/agent-protocol';
import type { HarnessAskStore } from '@/infrastructure/runtime/harness-asks';

/** Agent side of the harness ask store: every call is an `interaction.*` host request. */
export function createProtocolHarnessAsks(endpoint: AgentEndpoint): HarnessAskStore {
  const request = endpoint.request.bind(endpoint);
  return {
    createPendingAsk: async record => (await request('interaction.createPendingAsk', { record })).id,
    expireRequest: async (id) => {
      await request('interaction.expireRequest', { id });
    },
    resolveRequest: async (requestId, status, resolution, grant) => request('interaction.resolveWithGrant',
      { requestId, status, resolution, ...(grant ? { grant: { ...grant, grantOptions: { ...grant.grantOptions } } } : {}) }),
    matchGrant: params => request('interaction.matchGrant', params),
    sessionControl: sessionId => request('interaction.control', { sessionId }),
  };
}
