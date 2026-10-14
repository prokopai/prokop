import type { AgentEndpoint } from '@prokopai/agent-protocol';

const counters = new WeakMap<AgentEndpoint, { next: number }>();

/** `deliver` sequence numbers: one counter per connection, shared by every agent-side sender. */
export function nextDeliverSeq(endpoint: AgentEndpoint): number {
  let counter = counters.get(endpoint);
  if (!counter) {
    counter = { next: 0 };
    counters.set(endpoint, counter);
  }
  return counter.next++;
}
