import type { z } from 'zod';
import { agentToHostRequests } from './agent-to-host';
import { hostToAgentRequests } from './host-to-agent';
import { agentToHostNotifications, hostToAgentNotifications } from './notifications';

/** Bump on any breaking change; `initialize` rejects a mismatch. */
export const PROTOCOL_VERSION = 1;

export const protocol = {
  hostToAgent: { requests: hostToAgentRequests, notifications: hostToAgentNotifications },
  agentToHost: { requests: agentToHostRequests, notifications: agentToHostNotifications },
} as const;

export type HostToAgentMethod = keyof typeof hostToAgentRequests;
export type AgentToHostMethod = keyof typeof agentToHostRequests;
export type HostToAgentParams<M extends HostToAgentMethod> = z.input<(typeof hostToAgentRequests)[M]['params']>;
export type HostToAgentResult<M extends HostToAgentMethod> = z.output<(typeof hostToAgentRequests)[M]['result']>;
export type AgentToHostParams<M extends AgentToHostMethod> = z.input<(typeof agentToHostRequests)[M]['params']>;
export type AgentToHostResult<M extends AgentToHostMethod> = z.output<(typeof agentToHostRequests)[M]['result']>;
export type AgentNotification = keyof typeof agentToHostNotifications;
export type AgentNotificationParams<M extends AgentNotification> = z.input<(typeof agentToHostNotifications)[M]['params']>;

export { agentToHostRequests, hostToAgentRequests, agentToHostNotifications, hostToAgentNotifications };
export { Audience } from './notifications';
export { CommitCheck, CommitWrite } from './commit';
export { AttachmentRecord, NativeRecord, PendingAskRecord } from './entities';
export { OriginToken, TurnSnapshot } from './host-to-agent';
export { RpcErrorCode, RpcNotification, RpcRequest, RpcResponse } from './jsonrpc';
export { protocolRegistry } from './registry';
