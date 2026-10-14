import { createAgentEndpoint, createHostEndpoint, createLoopback } from '@prokopai/agent-protocol';
import type { StorageBundle } from '@/infrastructure/storage/contracts';
import { configureStorage, getStorage } from '@/infrastructure/storage/runtime';
import { readEnv } from '@/infrastructure/runtime/env-compat';
import { createProtocolStorageBundle } from './agent-storage';
import { createStorageHostHandlers } from './host-storage';

/**
 * Experiment flag (docs/plans/host-agent-split.md, Phase 1): with
 * PROKOPAI_AGENT_LOOPBACK=1 the Prokop engine reaches host storage only
 * through the agent protocol, carried in-process. Off by default.
 */
export function agentLoopbackEnabled(): boolean {
  return readEnv('AGENT_LOOPBACK') === '1';
}

function reportProtocolError(error: Error): void {
  console.warn('[agent-bridge] protocol error:', error.message);
}

/**
 * With the flag set, replaces the configured runtime storage (the SQLite
 * bundle) with the same bundle reached through the protocol. Call after
 * `configureProkopStorage()` and before the execution scope is composed.
 */
export function configureAgentLoopbackStorage(): void {
  if (!agentLoopbackEnabled()) return;
  configureStorage(createLoopbackStorage(getStorage()).storage);
  console.info('[agent-bridge] Prokop storage runs through the agent protocol loopback');
}

/** Wraps a host bundle so every storage call crosses the protocol as JSON. */
export function createLoopbackStorage(hostBundle: StorageBundle): { storage: StorageBundle; close(): void } {
  const [hostChannel, agentChannel] = createLoopback();
  createHostEndpoint({
    channel: hostChannel,
    handlers: createStorageHostHandlers(hostBundle),
    onProtocolError: reportProtocolError,
  });
  const agent = createAgentEndpoint({ channel: agentChannel, handlers: {}, onProtocolError: reportProtocolError });
  return {
    storage: createProtocolStorageBundle(agent),
    close: () => agent.close(new Error('Agent loopback closed')),
  };
}
