import type { AskAuthority, ServerMessage } from '@prokopai/sdk';

export interface BrowserRequestsPort {
  resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null>;
  getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined;
  acceptsConnection(toolCallId: string, connectionId: string): boolean;
  connectionsChanged(): void;
}
let installed: BrowserRequestsPort | null = null;
export function installBrowserRequestsPort(port: BrowserRequestsPort): void { installed = port; }
export function getBrowserRequestsPort(): BrowserRequestsPort | null { return installed; }

export interface BrowserClient {
  clientId: string;
  clientType: string;
  capabilities: readonly string[];
  connectionIds: ReadonlySet<string>;
}

/** What the browser bridge needs from the connected clients: lookups and delivery. */
export interface BrowserClientsPort {
  clients(): Iterable<BrowserClient>;
  /** A live connection and the client it registered as (null before registration), or null when it is gone. */
  connection(connectionId: string): { clientId: string | null } | null;
  hasController(sessionId: string): boolean;
  sendToConnection(connectionId: string, message: ServerMessage): void;
  broadcastToSession(sessionId: string, message: ServerMessage): void;
  sendToAskTargets(sessionId: string, authority: AskAuthority, message: ServerMessage): void;
  notifyAnswerRequired(requestId: string, sessionId: string): void;
}
let clients: BrowserClientsPort | null = null;
export function installBrowserClientsPort(port: BrowserClientsPort): void { clients = port; }
export function browserClients(): BrowserClientsPort {
  if (!clients) throw new Error('Browser clients are not installed');
  return clients;
}
