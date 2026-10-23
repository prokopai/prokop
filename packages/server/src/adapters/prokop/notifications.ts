import { getPermissionTimeoutMs } from '@prokopai/core/infrastructure/runtime/environment';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getScheduledJobRepository } from '@/infrastructure/sqlite/scheduled-job-store';
import { getPermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { createNotificationRepository } from '@/infrastructure/sqlite/notification-repository';
import { createWebPushSender } from '@/infrastructure/web-push/sender';
import { canNotifyForSession as scheduledSessionCanNotify } from '@/domains/scheduling/notifications';
import {
  createNotificationsApplication,
  type NotificationsApplication,
} from '@/application/notifications';
import type { NotificationsApplicationDeps } from '@/application/ports/notifications';

/**
 * Prokop notification adapter (S4/S5). Wires the notification application to
 * the current store and web-push implementations. The scheduled-run
 * eligibility predicate comes from the scheduling domain (shared policy,
 * not duplicated). A module-level singleton keeps the pending-terminal
 * dispatch map shared between the wired application, the compat dispatch
 * module, and the transport ack handler.
 *
 * Who is looking and who controls a session is transport state. The
 * bootstrap supplies it through `configureNotificationPresence`; until then
 * nobody is attending and no session is controlled, which is what an empty
 * transport reports.
 */

export type NotificationPresence = Pick<NotificationsApplicationDeps, 'isAnyClientAttending' | 'controllerClientId'>;

let presence: NotificationPresence = {
  isAnyClientAttending: () => false,
  controllerClientId: () => null,
};

export function configureNotificationPresence(source: NotificationPresence): void {
  presence = source;
}

let singleton: NotificationsApplication | null = null;

export function getProkopNotificationsApplication(): NotificationsApplication {
  if (singleton) {
    return singleton;
  }

  const store = createNotificationRepository();
  const sender = createWebPushSender();

  singleton = createNotificationsApplication({
    store,
    sender,
    getSession,
    canNotifyForSession: (session) => scheduledSessionCanNotify(session, (id) => getScheduledJobRepository().get(id)),
    getPendingAsk: getPermissionRequestByRequestId,
    permissionTimeoutMs: getPermissionTimeoutMs,
    // Read at call time: the bootstrap configures presence after the singleton may exist.
    isAnyClientAttending: () => presence.isAnyClientAttending(),
    controllerClientId: (sessionId) => presence.controllerClientId(sessionId),
  });

  return singleton;
}
