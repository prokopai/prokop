import type { ClientDescriptor, ClientRegisterMessage, ClientRejectedMessage, ServerMessage } from '@prokopai/sdk';
import { createConnectionId, type ConnectionId } from './connection-id';
import { getBrowserRequestsPort } from '@/application/ports/browser';
import { broadcastEvent } from './broadcast';

function browserConnectionsChanged(): void {
  getBrowserRequestsPort()?.connectionsChanged();
  broadcastEvent({ type: 'mcp.changed', workspaceId: null });
}

// Types

export interface RegisteredClient {
  clientId: string;
  clientType: ClientDescriptor['clientType'];
  displayName: string;
  interactionMode: ClientDescriptor['interactionMode'];
  capabilities: string[];
  instanceMetadata?: Record<string, unknown>;
  connectionIds: Set<ConnectionId>;
  connectedAt: number;
  lastSeenAt: number;
}

export interface RegisteredConnection {
  connectionId: ConnectionId;
  clientId: string | null;
  connectedAt: number;
  lastSeenAt: number;
  /**
   * Opaque socket handle. Stored as `unknown` so the registry itself never
   * imports Bun WebSocket types. Only the Bun adapter sends or closes sockets.
   */
  ws: unknown;
  activeSessionIds: Set<string>;
  /** Someone is at this device, as last reported (see `ClientAttentionMessage`). */
  attending: boolean;
  attentionReportedAt: number;
}

/**
 * How long an "attending" report counts without a refresh. The client
 * refreshes about once a minute while someone is active and reports false
 * when they stop; a report older than this came from a client that went
 * quiet without saying so.
 */
export const ATTENTION_REPORT_TTL_MS = 3 * 60 * 1000;

// Registries

const clientsByClientId = new Map<string, RegisteredClient>();
const connectionsByConnectionId = new Map<ConnectionId, RegisteredConnection>();
const connectionsBySocket = new Map<unknown, RegisteredConnection>();

// Connection lifecycle

export function registerConnection(socket: unknown): ConnectionId {
  const connectionId = createConnectionId();
  const now = Date.now();

  const entry: RegisteredConnection = {
    connectionId,
    clientId: null,
    connectedAt: now,
    lastSeenAt: now,
    ws: socket,
    activeSessionIds: new Set(),
    attending: false,
    attentionReportedAt: 0,
  };

  connectionsByConnectionId.set(connectionId, entry);
  connectionsBySocket.set(socket, entry);

  return connectionId;
}

export function unregisterConnection(socket: unknown): void {
  const conn = connectionsBySocket.get(socket);
  if (!conn) return;

  connectionsBySocket.delete(socket);
  connectionsByConnectionId.delete(conn.connectionId);

  if (conn.clientId) {
    const client = clientsByClientId.get(conn.clientId);
    if (client) {
      client.connectionIds.delete(conn.connectionId);
      if (client.connectionIds.size === 0) {
        clientsByClientId.delete(conn.clientId);
      }
      if (client.clientType === 'extension') browserConnectionsChanged();
    }
  }
}

// Client registration

function validateClientDescriptor(descriptor: unknown): { valid: true; descriptor: ClientDescriptor } | { valid: false; code: ClientRejectedMessage['code']; message: string } {
  if (!descriptor || typeof descriptor !== 'object') {
    return { valid: false, code: 'invalid_client', message: 'Missing or invalid client descriptor' };
  }

  const d = descriptor as Record<string, unknown>;

  if (typeof d.clientId !== 'string' || d.clientId.length === 0) {
    return { valid: false, code: 'invalid_client', message: 'clientId is required and must be a non-empty string' };
  }

  const validClientTypes = ['desktop', 'web', 'extension', 'sdk', 'mobile'] as const;
  if (typeof d.clientType !== 'string' || !(validClientTypes as readonly string[]).includes(d.clientType)) {
    return { valid: false, code: 'invalid_client', message: `clientType must be one of: ${validClientTypes.join(', ')}` };
  }

  if (typeof d.displayName !== 'string' || d.displayName.length === 0) {
    return { valid: false, code: 'invalid_client', message: 'displayName is required and must be a non-empty string' };
  }

  const validInteractionModes = ['human', 'headless', 'hybrid'] as const;
  if (typeof d.interactionMode !== 'string' || !(validInteractionModes as readonly string[]).includes(d.interactionMode)) {
    return { valid: false, code: 'invalid_client', message: `interactionMode must be one of: ${validInteractionModes.join(', ')}` };
  }

  if (!Array.isArray(d.capabilities) || !d.capabilities.every(c => typeof c === 'string')) {
    return { valid: false, code: 'invalid_client', message: 'capabilities must be an array of strings' };
  }

  return {
    valid: true,
    descriptor: d as unknown as ClientDescriptor,
  };
}

export function handleClientRegistration(
  connectionId: ConnectionId,
  msg: ClientRegisterMessage,
  send: (connectionId: ConnectionId, msg: ServerMessage) => void,
): void {
  const conn = connectionsByConnectionId.get(connectionId);
  if (!conn) return;

  const validation = validateClientDescriptor(msg.client);
  if (!validation.valid) {
    send(connectionId, {
      type: 'client.rejected',
      code: validation.code,
      message: validation.message,
    });
    console.warn(
      `[control] Registration rejected for connection ${conn.connectionId}: ${validation.message}`,
    );
    return;
  }

  const descriptor = validation.descriptor;
  const now = Date.now();

  conn.lastSeenAt = now;

  const existingClient = clientsByClientId.get(descriptor.clientId);

  if (existingClient) {
    existingClient.connectionIds.add(conn.connectionId);
    existingClient.lastSeenAt = now;
    existingClient.capabilities = descriptor.capabilities;
    existingClient.instanceMetadata = descriptor.instanceMetadata;
  } else {
    const newClient: RegisteredClient = {
      clientId: descriptor.clientId,
      clientType: descriptor.clientType,
      displayName: descriptor.displayName,
      interactionMode: descriptor.interactionMode,
      capabilities: descriptor.capabilities,
      instanceMetadata: descriptor.instanceMetadata,
      connectionIds: new Set([conn.connectionId]),
      connectedAt: now,
      lastSeenAt: now,
    };
    clientsByClientId.set(descriptor.clientId, newClient);
  }

  conn.clientId = descriptor.clientId;
  if (descriptor.clientType === 'extension') browserConnectionsChanged();

  send(connectionId, {
    type: 'client.registered',
    client: descriptor,
    connectionId: conn.connectionId,
    serverTime: now,
  });

  console.log(
    `[control] Client registered: clientId=${descriptor.clientId} ` +
    `type=${descriptor.clientType} connectionId=${conn.connectionId}`,
  );
}

// Lookup helpers

export function getConnectionBySocket(socket: unknown): RegisteredConnection | undefined {
  return connectionsBySocket.get(socket);
}

export function getConnectionById(connectionId: ConnectionId): RegisteredConnection | undefined {
  return connectionsByConnectionId.get(connectionId);
}

export function getAllConnections(): RegisteredConnection[] {
  return Array.from(connectionsByConnectionId.values());
}

export function getClientByClientId(clientId: string): RegisteredClient | undefined {
  return clientsByClientId.get(clientId);
}

export function getClientIdForSocket(socket: unknown): string | null {
  return connectionsBySocket.get(socket)?.clientId ?? null;
}

export function getClientIdForConnection(connectionId: ConnectionId): string | null {
  return connectionsByConnectionId.get(connectionId)?.clientId ?? null;
}

export function isClientRegistered(socket: unknown): boolean {
  return connectionsBySocket.get(socket)?.clientId != null;
}

// Heartbeat

export function touchConnection(socket: unknown): void {
  const conn = connectionsBySocket.get(socket);
  if (conn) {
    conn.lastSeenAt = Date.now();
    if (conn.clientId) {
      const client = clientsByClientId.get(conn.clientId);
      if (client) {
        client.lastSeenAt = Date.now();
      }
    }
  }
}

// Debug / introspection

export function getRegisteredClientCount(): number {
  return clientsByClientId.size;
}

export function getConnectionCount(): number {
  return connectionsByConnectionId.size;
}

export function getAllClients(): ReadonlyMap<string, RegisteredClient> {
  return clientsByClientId;
}

// Session-scoped connection lookups

export function getConnectionsForClient(clientId: string): RegisteredConnection[] {
  const client = clientsByClientId.get(clientId);
  if (!client) return [];
  const result: RegisteredConnection[] = [];
  for (const connId of client.connectionIds) {
    const conn = connectionsByConnectionId.get(connId);
    if (conn) result.push(conn);
  }
  return result;
}

export function getAllConnectionsWithActiveSession(sessionId: string): RegisteredConnection[] {
  const result: RegisteredConnection[] = [];
  for (const conn of connectionsByConnectionId.values()) {
    if (conn.activeSessionIds.has(sessionId)) {
      result.push(conn);
    }
  }
  return result;
}

// Attention

export function setConnectionAttention(connectionId: ConnectionId, attending: boolean, now: number = Date.now()): void {
  const conn = connectionsByConnectionId.get(connectionId);
  if (!conn) return;
  conn.attending = attending;
  conn.attentionReportedAt = now;
}

/** Whether any connected device reported someone present recently enough. */
export function isAnyConnectionAttending(now: number = Date.now()): boolean {
  for (const conn of connectionsByConnectionId.values()) {
    if (conn.attending && now - conn.attentionReportedAt <= ATTENTION_REPORT_TTL_MS) return true;
  }
  return false;
}
