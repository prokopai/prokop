import {
  createAgentEndpoint, createHostEndpoint, createLoopback,
  type AgentEndpoint, type AgentHandlers, type AgentSide, type HostEndpoint, type HostHandlers, type NotificationHandlers,
} from '@prokopai/agent-protocol';
import type { StorageBundle } from '@/infrastructure/storage/contracts';
import { readEnv } from '@/infrastructure/runtime/env-compat';
import { createProtocolStorageBundle } from '@/agent';
import { createStorageHostHandlers } from './host-storage';

/**
 * Experiment flag (docs/plans/host-agent-split.md, Phase 1): with
 * PROKOPAI_AGENT_LOOPBACK=1 the Prokop engine reaches the host only through
 * the agent protocol, carried in-process. Off by default.
 */
export function agentLoopbackEnabled(): boolean {
  return readEnv('AGENT_LOOPBACK') === '1';
}

/**
 * Phase 2 flag: with PROKOPAI_AGENT_PROCESS=1 the harnesses run in a
 * separate agent process (packages/agent) that the host supervises.
 * PROKOPAI_AGENT_LOOPBACK=1 keeps them in process.
 */
export function agentProcessEnabled(): boolean {
  // An explicit loopback is the narrower choice and wins when both are set.
  return readEnv('AGENT_PROCESS') === '1' && !agentLoopbackEnabled();
}

function reportProtocolError(error: Error): void {
  console.warn('[agent-bridge] protocol error:', error.message);
}

/**
 * One in-process agent connection: the host serves `host`, the returned
 * endpoint is what agent-side ports call. Every message crosses as JSON.
 */
export function createAgentLoopback(host: {
  handlers: HostHandlers;
  notifications?: NotificationHandlers<AgentSide>;
}, agentHandlers: AgentHandlers = {}): { agent: AgentEndpoint; host: HostEndpoint; close(): void } {
  const [hostChannel, agentChannel] = createLoopback();
  const hostEndpoint = createHostEndpoint({
    channel: hostChannel,
    handlers: host.handlers,
    notifications: host.notifications,
    onProtocolError: reportProtocolError,
  });
  const agent = createAgentEndpoint({ channel: agentChannel, handlers: agentHandlers, onProtocolError: reportProtocolError });
  return { agent, host: hostEndpoint, close: () => agent.close(new Error('Agent loopback closed')) };
}

/** Wraps a host bundle so every storage call crosses the protocol as JSON. */
export function createLoopbackStorage(hostBundle: StorageBundle): { storage: StorageBundle; close(): void } {
  const { agent, close } = createAgentLoopback({ handlers: createStorageHostHandlers(hostBundle) });
  return { storage: createProtocolStorageBundle(agent), close };
}
