import type {
  AssistantMessage,
  ProkopaiPushPayloadV1,
  NotificationEventType,
  NotificationPreferences,
  PushSubscriptionRecord,
  WebPushSubscriptionInput,
} from '@prokopai/sdk';
import {
  buildPushPayloadV1,
  buildRetryPushPayloadV1,
  classifyPushSendResult,
  classifyRetryAttempt,
  decideTerminalNotification,
  deliveryCleanupCutoff,
  isPendingAskStatus,
  permissionEventId,
  PUSH_DISPATCH_DELAY_MS,
  questionEventId,
  PUSH_TTL_SECONDS,
  RETRY_NEXT_ATTEMPT_MS,
  shouldExhaustRetries,
} from '@/domains/notifications';
import type { NotificationsApplicationDeps } from '@/application/ports/notifications';

/**
 * Notification use cases (S4/S5). Own the route-level subscription flows and
 * the delivery orchestration (reservation-before-send idempotency, the
 * terminal and ask dispatch delays, the active-client suppression map, the
 * retry tick, and the delivery cleanup). The reservation store, the push
 * sender, and the scheduled-run eligibility stay behind ports.
 *
 * One person, several devices: every push goes to every enabled device, and
 * any device showing the event to someone who is present cancels it for all
 * of them within the dispatch delay. Which device controls the session does
 * not matter here; control decides who may act, not who is told.
 */

interface PendingNotificationDispatch {
  sessionId: string;
  timeout: ReturnType<typeof setTimeout>;
}

export interface NotificationsApplication {
  getConfig(): { available: boolean; vapidPublicKey: string; permissionTimeoutMs: number };
  upsertSubscription(input: {
    clientId: string;
    clientServerId: string;
    clientOrigin: string;
    subscription: WebPushSubscriptionInput;
    preferences: NotificationPreferences;
  }): PushSubscriptionRecord;
  updatePreferences(id: string, preferences: NotificationPreferences): PushSubscriptionRecord | null;
  deleteSubscription(id: string): void;
  dispatch(input: { eventId: string; eventType: NotificationEventType; sessionId: string }): Promise<void>;
  notifyTerminalMessage(message: AssistantMessage, sessionId: string): void;
  acknowledgePendingNotification(eventId: string, sessionId: string, clientId: string): boolean;
  dispatchPendingAnswerNotification(requestId: string, rootSessionId: string): Promise<void>;
  notifyAnswerRequired(requestId: string, rootSessionId: string): void;
  runRetryTick(): Promise<void>;
  cleanup(now: number): number;
}

export function createNotificationsApplication(
  deps: NotificationsApplicationDeps,
): NotificationsApplication {
  const pendingDispatches = new Map<string, PendingNotificationDispatch>();

  function askEvent(requestId: string, isPermission: boolean, rootSessionId: string): {
    eventId: string;
    eventType: NotificationEventType;
    sessionId: string;
  } {
    return isPermission
      ? { eventId: permissionEventId(requestId), eventType: 'permission_required', sessionId: rootSessionId }
      : { eventId: questionEventId(requestId), eventType: 'question_asked', sessionId: rootSessionId };
  }

  async function dispatchPendingAnswerNotification(
    requestId: string,
    rootSessionId: string,
  ): Promise<void> {
    const pending = deps.getPendingAsk(requestId);
    if (!pending || !isPendingAskStatus(pending.status)) {
      return;
    }

    const session = deps.getSession(rootSessionId);
    if (!session || !deps.canNotifyForSession(session)) {
      return;
    }

    await dispatch(askEvent(requestId, pending.isPermission, rootSessionId));
  }

  function buildPayload(
    subscription: { client_server_id: string },
    eventId: string,
    eventType: NotificationEventType,
    sessionId: string,
  ): ProkopaiPushPayloadV1 {
    return buildPushPayloadV1(subscription, eventId, eventType, sessionId, Date.now());
  }

  async function dispatch(input: {
    eventId: string;
    eventType: NotificationEventType;
    sessionId: string;
  }): Promise<void> {
    const { eventId, eventType, sessionId } = input;

    const subscriptions = deps.store.listEnabledForEvent(eventType);
    if (subscriptions.length === 0) {
      console.info(`[web-push] No enabled subscriptions for ${eventType}`, { eventId });
      return;
    }

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const isNew = deps.store.reserveDelivery({
          eventId,
          subscriptionId: sub.id,
          eventType,
        });
        if (!isNew) {
          return; // Already dispatched or reserved
        }

        const payload = buildPayload(sub, eventId, eventType, sessionId);
        const payloadStr = JSON.stringify(payload);

        try {
          const result = await deps.sender.send({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
            payload: payloadStr,
            ttl: PUSH_TTL_SECONDS,
          });

          const outcome = classifyPushSendResult(result);

          if (outcome.kind === 'delivered') {
            deps.store.markDelivered(eventId, sub.id);
            console.info('[web-push] Delivery succeeded', {
              eventId,
              eventType,
              subscriptionId: sub.id,
            });
            return;
          }

          if (outcome.kind === 'stale') {
            deps.store.deleteStaleSubscription(sub.id);
            console.warn('[web-push] Removed stale subscription', {
              eventId,
              eventType,
              subscriptionId: sub.id,
              statusCode: result.statusCode,
              reason: outcome.reason,
            });
            return;
          }

          if (outcome.kind === 'transient') {
            const nextAttempt = Date.now() + RETRY_NEXT_ATTEMPT_MS;
            deps.store.markRetryable(eventId, sub.id, outcome.error, nextAttempt);
            console.warn('[web-push] Delivery scheduled for retry', {
              eventId,
              eventType,
              subscriptionId: sub.id,
              statusCode: result.statusCode,
              error: outcome.error,
            });
            return;
          }

          deps.store.markFailed(eventId, sub.id, outcome.error);
          console.warn('[web-push] Delivery failed permanently', {
            eventId,
            eventType,
            subscriptionId: sub.id,
            statusCode: result.statusCode,
            error: outcome.error,
          });
        } catch (err: unknown) {
          // Network error: transient, record for retry
          const message = err instanceof Error ? err.message : String(err);
          const nextAttempt = Date.now() + RETRY_NEXT_ATTEMPT_MS;
          deps.store.markRetryable(eventId, sub.id, message, nextAttempt);
          console.warn('[web-push] Delivery scheduled for retry', {
            eventId,
            eventType,
            subscriptionId: sub.id,
            statusCode: 0,
            error: message,
          });
        }
      }),
    );
  }

  /**
   * Holds a push for the dispatch delay so a device already showing the
   * event can cancel it. The same event scheduled twice keeps one timer.
   */
  function scheduleDispatch(
    key: { eventId: string; sessionId: string },
    run: () => Promise<void>,
    label: string,
  ): void {
    if (pendingDispatches.has(key.eventId)) {
      return;
    }

    const timeout = setTimeout(() => {
      pendingDispatches.delete(key.eventId);
      run().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[web-push] ${label} dispatch failed: ${message}`);
      });
    }, PUSH_DISPATCH_DELAY_MS);

    pendingDispatches.set(key.eventId, {
      sessionId: key.sessionId,
      timeout,
    });
  }

  async function retryDelivery(delivery: {
    event_id: string;
    subscription_id: string;
    event_type: string;
    created_at: number;
    attempt_count: number;
  }): Promise<void> {
    const subscription = deps.store.getForDispatch(delivery.subscription_id);
    if (!subscription) {
      deps.store.markFailed(delivery.event_id, delivery.subscription_id, 'Subscription no longer exists');
      return;
    }

    const payload = buildRetryPushPayloadV1(delivery, subscription);
    const payloadStr = JSON.stringify(payload);

    try {
      const result = await deps.sender.send({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        payload: payloadStr,
        ttl: PUSH_TTL_SECONDS,
      });

      const outcome = classifyRetryAttempt(result, delivery.attempt_count, Date.now());

      if (outcome.kind === 'delivered') {
        deps.store.markDelivered(delivery.event_id, delivery.subscription_id);
        return;
      }
      if (outcome.kind === 'permanent_4xx') {
        deps.store.markFailed(delivery.event_id, delivery.subscription_id, outcome.error);
        return;
      }
      if (outcome.kind === 'exhausted') {
        deps.store.markExhausted(delivery.event_id, delivery.subscription_id);
        return;
      }
      deps.store.markRetryable(
        delivery.event_id,
        delivery.subscription_id,
        `HTTP ${result.statusCode}`,
        outcome.nextAttemptAt,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (shouldExhaustRetries(delivery.attempt_count)) {
        deps.store.markExhausted(delivery.event_id, delivery.subscription_id);
        return;
      }
      const nextAttempt = Date.now() + RETRY_NEXT_ATTEMPT_MS * (delivery.attempt_count + 1);
      deps.store.markRetryable(delivery.event_id, delivery.subscription_id, message, nextAttempt);
    }
  }

  return {
    getConfig() {
      const { available, vapidPublicKey } = deps.sender.config();
      return {
        available,
        vapidPublicKey,
        permissionTimeoutMs: deps.permissionTimeoutMs(),
      };
    },

    upsertSubscription(input) {
      return deps.store.upsertSubscription(input);
    },

    updatePreferences(id, preferences) {
      return deps.store.updatePreferences(id, preferences);
    },

    deleteSubscription(id) {
      deps.store.deleteSubscription(id);
    },

    dispatch,

    notifyTerminalMessage(message, sessionId) {
      const session = deps.getSession(sessionId);
      const result = decideTerminalNotification(message, session, deps.canNotifyForSession);
      if (!result) {
        return;
      }

      const event = { eventId: result.eventId, eventType: result.eventType, sessionId };
      scheduleDispatch(event, () => dispatch(event), 'Terminal message');
    },

    acknowledgePendingNotification(eventId, sessionId, clientId) {
      const pending = pendingDispatches.get(eventId);
      if (!pending || pending.sessionId !== sessionId) {
        return false;
      }

      // The client only acknowledges what it shows to someone present, and
      // that person is the one person all these devices belong to.
      clearTimeout(pending.timeout);
      pendingDispatches.delete(eventId);
      console.info('[web-push] Delivery suppressed by active client', {
        eventId,
        sessionId,
        clientId,
      });
      return true;
    },

    dispatchPendingAnswerNotification,

    notifyAnswerRequired(requestId, rootSessionId) {
      // The ask is stored before this is called; the id names the push the
      // client acknowledges when the ask is on a screen in front of someone.
      const isPermission = deps.getPendingAsk(requestId)?.isPermission ?? true;
      scheduleDispatch(
        askEvent(requestId, isPermission, rootSessionId),
        () => dispatchPendingAnswerNotification(requestId, rootSessionId),
        'Ask',
      );
    },

    async runRetryTick() {
      const now = Date.now();
      const dueDeliveries = deps.store.getDueForRetry(now);
      if (dueDeliveries.length === 0) return;

      for (const delivery of dueDeliveries) {
        try {
          await retryDelivery(delivery);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[web-push] Retry tick error for ${delivery.event_id}: ${message}`);
        }
      }
    },

    cleanup(now) {
      return deps.store.deleteAllOldDeliveries(deliveryCleanupCutoff(now));
    },
  };
}
