import { afterEach, describe, expect, test } from 'bun:test';
import { installWireApplication, type WireApplication } from '@/transport/websocket/application';
import { handleNotificationAcknowledge } from '@/transport/websocket/handlers/misc';
import {
  handleClientRegistration,
  registerConnection,
  unregisterConnection,
} from '@/transport/websocket/connection-registry';
import type { RouterContext } from '@/transport/websocket/router-context';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import type { NotificationsApplication } from '@/application/notifications';
import type { PermissionsApplication } from '@/application/permissions';
import type { ProvidersApplication } from '@/application/providers';
import type { SessionApplication, SessionControlApplication } from '@/application';
import type { NotificationAcknowledgeMessage } from '@prokopai/sdk';

interface AckSpy {
  acks: Array<{ eventId: string; sessionId: string; clientId: string }>;
}

function installNotifications(notifications: NotificationsApplication): void {
  const session = {} as SessionApplication<ConnectionId>;
  const control = {} as SessionControlApplication<ConnectionId>;
  const providers = {} as ProvidersApplication;
  const permissions = {} as PermissionsApplication;
  const wire: WireApplication = { session, control, providers, notifications, permissions };
  installWireApplication(wire);
}

function makeNotifications(spy: AckSpy, result: boolean): NotificationsApplication {
  return {
    getConfig: () => ({ available: true, vapidPublicKey: '', permissionTimeoutMs: 1000 }),
    upsertSubscription: () => ({ id: '', clientId: '', clientServerId: '', clientOrigin: '', expirationTime: null, preferences: { completion: false, permission: false }, createdAt: 0, updatedAt: 0 }),
    updatePreferences: () => null,
    deleteSubscription: () => {},
    dispatch: async () => {},
    notifyTerminalMessage: () => {},
    acknowledgePendingNotification: (eventId, sessionId, clientId) => {
      spy.acks.push({ eventId, sessionId, clientId });
      return result;
    },
    dispatchPendingAnswerNotification: async () => {},
    notifyAnswerRequired: () => {},
    runRetryTick: async () => {},
    cleanup: () => 0,
  };
}

function makeCtx(): RouterContext<ConnectionId> {
  return {
    send: () => {},
    broadcast: () => {},
    broadcastToSession: () => {},
    sendToController: () => {},
    sendToAskTargets: () => {},
    clients: new Map(),
  };
}

function ackMessage(overrides: Partial<NotificationAcknowledgeMessage> = {}): NotificationAcknowledgeMessage {
  return {
    type: 'notification.acknowledge',
    eventId: 'message:m1:completed',
    sessionId: 'sess-1',
    ...overrides,
  };
}

afterEach(() => {
  installNotifications(makeNotifications({ acks: [] }, false));
});

describe('notification acknowledge wire handler', () => {
  test('delegates the exact acknowledge inputs to the wired notifications application', () => {
    const spy: AckSpy = { acks: [] };
    installNotifications(makeNotifications(spy, true));

    const socket = {};
    const connectionId = registerConnection(socket);
    handleClientRegistration(connectionId, {
      type: 'client.register',
      client: {
        clientId: 'client-1',
        clientType: 'web',
        displayName: 'Client 1',
        interactionMode: 'human',
        capabilities: [],
      },
    }, () => {});

    handleNotificationAcknowledge(makeCtx(), connectionId, ackMessage());

    expect(spy.acks).toEqual([
      { eventId: 'message:m1:completed', sessionId: 'sess-1', clientId: 'client-1' },
    ]);
    unregisterConnection(socket);
  });

  test('does not acknowledge for unregistered connections', () => {
    const spy: AckSpy = { acks: [] };
    installNotifications(makeNotifications(spy, true));

    // No registered connection maps to a client id, so the handler returns
    // before invoking the application.
    handleNotificationAcknowledge(makeCtx(), 'unknown' as ConnectionId, ackMessage());
    expect(spy.acks).toEqual([]);
  });
});

describe('client attention', () => {
  test('a device counts as attended from its report until the report ages out', async () => {
    const { handleClientAttention } = await import('@/transport/websocket/handlers/misc');
    const { ATTENTION_REPORT_TTL_MS, isAnyConnectionAttending, setConnectionAttention } = await import('@/transport/websocket/connection-registry');
    const socket = {};
    const connectionId = registerConnection(socket);
    try {
      expect(isAnyConnectionAttending()).toBe(false);
      handleClientAttention(makeCtx(), connectionId, { type: 'client.attention', attending: true });
      expect(isAnyConnectionAttending()).toBe(true);
      // Quiet for longer than the TTL: the socket may have died without a close.
      expect(isAnyConnectionAttending(Date.now() + ATTENTION_REPORT_TTL_MS + 1)).toBe(false);
      handleClientAttention(makeCtx(), connectionId, { type: 'client.attention', attending: false });
      expect(isAnyConnectionAttending()).toBe(false);
      // A malformed flag never counts as present.
      handleClientAttention(makeCtx(), connectionId, { type: 'client.attention', attending: 'yes' as unknown as boolean });
      expect(isAnyConnectionAttending()).toBe(false);
      setConnectionAttention(connectionId, true);
      expect(isAnyConnectionAttending()).toBe(true);
    } finally {
      unregisterConnection(socket);
    }
    // Gone with the connection.
    expect(isAnyConnectionAttending()).toBe(false);
  });
});
