import type { ServerMessage, Session, AskAuthority } from '@prokopai/sdk';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { installWorkspaceActivityListener } from '@/application/workspaces/activity';
import { participantConnectionIdsFor } from './delivery';
import { installWorkspaceFilesChangedListener } from '@prokopai/core/application/workspaces/files-changed';

export type BroadcastFn = (message: ServerMessage) => void;

export type BroadcastSessionFn = (session: Session) => void;

export type SendToAskTargetsFn = (
  sessionId: string,
  authority: AskAuthority,
  message: ServerMessage,
) => void;

/**
 * Delivery port covering the five Jean2 audiences: origin, session,
 * controller, ask-target, and global broadcast.
 *
 * S2 contract: production bootstrap installs the concrete transport port via
 * `installDeliveryPort`.
 */
export interface DeliveryPort {
  readonly sendToConnection: (connectionId: ConnectionId, message: ServerMessage) => void;
  readonly broadcast: (message: ServerMessage, excludeConnectionId?: ConnectionId) => void;
  readonly broadcastToSession: (sessionId: string, message: ServerMessage, excludeConnectionId?: ConnectionId) => void;
  readonly sendToController: (sessionId: string, message: ServerMessage) => void;
  readonly sendToAskTargets: (sessionId: string, authority: AskAuthority, message: ServerMessage) => void;
}

let installedPort: DeliveryPort | null = null;

export function installDeliveryPort(port: DeliveryPort): void {
  installedPort = port;
  installWorkspaceActivityListener((workspaceId, lastConversationAt) => {
    port.broadcast({ type: 'workspace.conversation_activity', workspaceId, lastConversationAt });
  });
  installWorkspaceFilesChangedListener((workspaceId) => {
    port.broadcast({ type: 'files.changed', workspaceId });
  });
}

export function broadcastSessionCreated(session: Session): void {
  const message: ServerMessage = {
    type: 'session.created',
    session,
  };

  installedPort?.broadcast(message);
}

export function broadcastSessionCreatedExclude(
  session: Session,
  excludeConnectionId?: ConnectionId,
): void {
  const message: ServerMessage = {
    type: 'session.created',
    session,
  };

  installedPort?.broadcast(message, excludeConnectionId);
}

export function broadcastSessionUpdated(session: Session): void {
  const message: ServerMessage = {
    type: 'session.updated',
    session,
  };

  installedPort?.broadcast(message);
}

export function broadcastEvent(message: ServerMessage): void {
  installedPort?.broadcast(message);
}

export function sendToConnectionEvent(connectionId: ConnectionId, message: ServerMessage): void {
  installedPort?.sendToConnection(connectionId, message);
}

export function sendToControllerEvent(sessionId: string, message: ServerMessage): void {
  if (installedPort) {
    installedPort.sendToController(sessionId, message);
    return;
  }
  broadcastEvent(message);
}

export function broadcastToSessionEvent(sessionId: string, message: ServerMessage): void {
  if (installedPort) {
    installedPort.broadcastToSession(sessionId, message);
    return;
  }
  broadcastEvent(message);
}

/**
 * One delivery per connection that participates in any of the sessions. A
 * delegated child's events go to the child's participants and the parent's:
 * clients follow a child from the session that started it.
 */
export function broadcastToSessionsEvent(sessionIds: readonly string[], message: ServerMessage): void {
  if (!installedPort) {
    broadcastEvent(message);
    return;
  }
  const seen = new Set<ConnectionId>();
  for (const sessionId of sessionIds) {
    for (const connectionId of participantConnectionIdsFor(sessionId)) {
      if (seen.has(connectionId)) continue;
      seen.add(connectionId);
      installedPort.sendToConnection(connectionId, message);
    }
  }
}

/**
 * Send an ask to the delivery targets resolved from the ask's authority.
 *
 * With an installed delivery port this delegates to transport resolution
 * (the ask-routing domain is the single target-resolution owner, injected
 * at bootstrap). Without an installed port, delivery falls back to the
 * controller-only path and does not re-resolve ask-target policy.
 */
export function sendToAskTargetsEvent(
  sessionId: string,
  authority: AskAuthority,
  message: ServerMessage,
): void {
  if (installedPort) {
    installedPort.sendToAskTargets(sessionId, authority, message);
    return;
  }

  sendToControllerEvent(sessionId, message);
}
