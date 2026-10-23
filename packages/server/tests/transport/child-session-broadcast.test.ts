/**
 * A delegated child's session events reach the child's participants and the
 * parent's, once per connection: clients follow a child from the session
 * that started it, and a client watching both is not told twice.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ServerMessage } from '@prokopai/sdk';
import { broadcastToSessionsEvent, installDeliveryPort } from '@/transport/websocket/broadcast';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { handleClientRegistration, registerConnection, unregisterConnection } from '@/transport/websocket/connection-registry';
import { addParticipant, removeSessionControl } from '@/transport/websocket/control-registry';

let sockets: object[];
let sent: Array<{ connection: ConnectionId; type: string }>;
const silent = { sendToConnection: () => {}, sendToAskTargets: () => {}, broadcast: () => {}, broadcastToSession: () => {}, sendToController: () => {} };

function connect(clientId: string): ConnectionId {
  const socket = {}; sockets.push(socket);
  const connection = registerConnection(socket);
  handleClientRegistration(connection, { type: 'client.register', client: { clientId, clientType: 'web',
    displayName: clientId, interactionMode: 'human', capabilities: [] } }, () => {});
  return connection;
}

beforeEach(() => {
  sockets = []; sent = [];
  installDeliveryPort({ ...silent, sendToConnection: (connection, message: ServerMessage) => { sent.push({ connection, type: message.type }); } });
});
afterEach(() => {
  removeSessionControl('parent'); removeSessionControl('child');
  for (const socket of sockets) unregisterConnection(socket);
  installDeliveryPort(silent);
});

test('a child event reaches the parent\'s viewer and the child\'s viewer once each', () => {
  const parentViewer = connect('on-parent');
  const childViewer = connect('on-child');
  const both = connect('on-both');
  const elsewhere = connect('elsewhere');
  addParticipant('parent', parentViewer, 'on-parent');
  addParticipant('child', childViewer, 'on-child');
  addParticipant('parent', both, 'on-both');
  addParticipant('child', both, 'on-both');

  broadcastToSessionsEvent(['child', 'parent'], { type: 'part.append', sessionId: 'child', partId: 'p', field: 'text', delta: 'x' } as ServerMessage);

  expect(sent.map(entry => entry.connection).sort()).toEqual([parentViewer, childViewer, both].sort());
  expect(sent.some(entry => entry.connection === elsewhere)).toBe(false);
});
