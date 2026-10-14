import type { HostEndpoint } from '@prokopai/agent-protocol';
import type { CodexModel, HarnessUsageLimits } from '@prokopai/sdk';
import type { HarnessProbePort } from '@/application/ports/harness-probes';

/** Host side of the CLI probes: each read is an agent request. */
export function createProtocolHarnessProbes(endpoint: () => HostEndpoint): HarnessProbePort {
  return {
    models: async harness => (await endpoint().request('models.list', { harness })).models as unknown as CodexModel[],
    usageLimits: async harness => await endpoint().request('usage.limits', { harness }) as unknown as HarnessUsageLimits,
    nativeTitle: async sessionId => (await endpoint().request('title.native', { sessionId })).title,
  };
}
