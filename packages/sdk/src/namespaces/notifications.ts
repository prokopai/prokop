import type { ClientMessage } from '../shared';

export class NotificationsNamespace {
  constructor(private send: (msg: ClientMessage) => void) {}

  acknowledge(eventId: string, sessionId: string): void {
    this.send({
      type: 'notification.acknowledge',
      eventId,
      sessionId,
    });
  }

  /** Tells the server whether someone is at this device (see `ClientAttentionMessage`). */
  reportAttention(attending: boolean): void {
    this.send({
      type: 'client.attention',
      attending,
    });
  }
}
