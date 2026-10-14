import { agentToHostRequests } from './agent-to-host';
import {
  createEndpoint, type Endpoint, type MessageChannel, type NotificationHandlers, type RequestHandlers,
} from './endpoint';
import { hostToAgentRequests } from './host-to-agent';
import { agentToHostNotifications, hostToAgentNotifications } from './notifications';

const hostSide = { requests: hostToAgentRequests, notifications: hostToAgentNotifications };
const agentSide = { requests: agentToHostRequests, notifications: agentToHostNotifications };

export type HostSide = typeof hostSide;
export type AgentSide = typeof agentSide;
/** What the host holds: it calls agent methods and serves agent requests. */
export type HostEndpoint = Endpoint<HostSide>;
/** What the agent holds: it calls host methods and serves host requests. */
export type AgentEndpoint = Endpoint<AgentSide>;
export type HostHandlers = RequestHandlers<AgentSide>;
export type AgentHandlers = RequestHandlers<HostSide>;

export function createHostEndpoint(options: {
  channel: MessageChannel;
  handlers: HostHandlers;
  notifications?: NotificationHandlers<AgentSide>;
  onProtocolError?: (error: Error) => void;
}): HostEndpoint {
  return createEndpoint({ ...options, outgoing: hostSide, incoming: agentSide });
}

export function createAgentEndpoint(options: {
  channel: MessageChannel;
  handlers: AgentHandlers;
  notifications?: NotificationHandlers<HostSide>;
  onProtocolError?: (error: Error) => void;
}): AgentEndpoint {
  return createEndpoint({ ...options, outgoing: agentSide, incoming: hostSide });
}
