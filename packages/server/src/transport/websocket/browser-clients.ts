import type { BrowserClientsPort } from '@/application/ports/browser';
import type { ConnectionId } from './connection-id';
import { getAllClients, getConnectionById } from './connection-registry';
import { getControllerConnections } from './control-registry';
import { broadcastToSessionEvent, sendToAskTargetsEvent, sendToConnectionEvent } from './broadcast';

/** The browser bridge's view of the WebSocket clients. Push notifications come from the caller. */
export function createBrowserClientsPort(
  notifyPermissionRequired: BrowserClientsPort['notifyPermissionRequired'],
): BrowserClientsPort {
  return {
    clients: () => getAllClients().values(),
    connection: (connectionId) => {
      const connection = getConnectionById(connectionId as ConnectionId);
      return connection ? { clientId: connection.clientId } : null;
    },
    hasController: sessionId => getControllerConnections(sessionId).length > 0,
    sendToConnection: (connectionId, message) => sendToConnectionEvent(connectionId as ConnectionId, message),
    broadcastToSession: broadcastToSessionEvent,
    sendToAskTargets: sendToAskTargetsEvent,
    notifyPermissionRequired,
  };
}
