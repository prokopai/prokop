import type { NotificationsApplication } from '@/application/notifications';
import type { RuntimeDelivery } from '@/infrastructure/runtime/events';
import type { RuntimeHost as ProkopCompatibilityBindings } from '@/infrastructure/runtime/host';
import {
  broadcastEvent,
  broadcastToSessionEvent,
  sendToAskTargetsEvent,
  sendToControllerEvent,
} from '@/transport/websocket/broadcast';
import { getProkopNotificationsApplication } from '@/adapters/prokop/notifications';
import { audienceOf, mapCapekEventToServerMessage } from '@/agent';

/**
 * Host side of runtime events: terminal events become push notifications,
 * the rest go to the WebSocket router by audience. The in-process runtime
 * host's delivery; in the agent process the same events arrive as `deliver`
 * and `host.notify`.
 */
export function deliverCapekEvent(
  delivery: RuntimeDelivery,
  notifications?: Pick<NotificationsApplication, 'notifyTerminalMessage'>,
): void {
  if (delivery.event.kind === 'terminal') {
    (notifications ?? getProkopNotificationsApplication()).notifyTerminalMessage(
      delivery.event.message,
      delivery.event.sessionId,
    );
    return;
  }

  const message = mapCapekEventToServerMessage(delivery.event);
  if (!message) return;

  const audience = audienceOf(delivery);
  switch (audience.scope) {
    case 'global':
      broadcastEvent(message);
      break;
    case 'session':
      broadcastToSessionEvent(audience.sessionId, message);
      break;
    case 'controller':
      sendToControllerEvent(audience.sessionId, message);
      break;
    case 'ask_targets':
      sendToAskTargetsEvent(audience.sessionId, audience.authority, message);
      break;
    case 'origin':
    case 'host':
      break;
  }
}

export const prokopDeliveryBindings: ProkopCompatibilityBindings['delivery'] = {
  emit: deliverCapekEvent,
};
