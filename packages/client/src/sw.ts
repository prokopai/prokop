/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  NOTIFICATION_COPY,
  parsePushData,
  isSameOriginRoute,
  normalizeRoute,
  shouldShowPushNotification,
} from './pwa/sw-logic';

declare const self: ServiceWorkerGlobalScope;

// ── Precaching ────────────────────────────────────────────────
// The __WB_MANIFEST is injected at build time by vite-plugin-pwa.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── SPA Navigation Fallback ───────────────────────────────────
// Explicitly replicate the generateSW navigation fallback behavior with
// denylist for /api/ and /ws/ (injectManifest does not apply the old
// navigateFallback options automatically).
const handler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api\//, /^\/ws/],
});
registerRoute(navigationRoute);

// ── Update Flow ───────────────────────────────────────────────
// Jean2 intentionally waits for the user's "Restart now" action.
// Do NOT call skipWaiting() during normal installation.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  } else if (event.data?.type === 'CLEAR_APP_BADGE') {
    event.waitUntil(updateBadge(0));
  }
});

// After the user requests activation and the worker enters its activate
// phase, claim existing clients so the controllerchange reload flow works.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Push Notifications ────────────────────────────────────────

async function updateBadge(delta: number): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (delta > 0 && nav.setAppBadge) {
      await nav.setAppBadge();
    } else if (nav.clearAppBadge) {
      await nav.clearAppBadge();
    }
  } catch {
    // Badge API not supported or failed; non-critical
  }
}

self.addEventListener('push', (event) => {
  let parsed: unknown;
  try {
    parsed = event.data?.json();
  } catch {
    return;
  }
  const payload = parsePushData(parsed);
  if (!payload) {
    return;
  }

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const subscription = await self.registration.pushManager.getSubscription().catch(() => null);
      const show = shouldShowPushNotification({
        clients: allClients.map((c) => ({
          visibilityState: c.visibilityState,
          focused: c.focused,
        })),
        endpoint: subscription?.endpoint,
      });
      if (!show) {
        return;
      }

      const copy = NOTIFICATION_COPY[payload.type];
      await self.registration.showNotification(copy.title, {
        body: copy.body,
        tag: payload.eventId,
        timestamp: payload.createdAt,
        data: { route: payload.route },
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      });
      await updateBadge(1);
    })(),
  );
});

// ── Notification Click ────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const route = event.notification.data?.route as string | undefined;
  if (!route || !isSameOriginRoute(route, self.location.origin)) {
    return;
  }

  const targetPath = normalizeRoute(route, self.location.origin);
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        const clientUrl = new URL(client.url, self.location.origin);
        if (clientUrl.origin !== self.location.origin) {
          continue;
        }

        try {
          let targetClient = client;
          if (clientUrl.pathname + clientUrl.search + clientUrl.hash !== targetPath) {
            if (typeof client.navigate === 'function') {
              const navigatedClient = await client.navigate(targetUrl);
              if (navigatedClient) {
                targetClient = navigatedClient;
              } else {
                client.postMessage({ type: 'NAVIGATE_TO_NOTIFICATION', route: targetPath });
              }
            } else {
              client.postMessage({ type: 'NAVIGATE_TO_NOTIFICATION', route: targetPath });
            }
          }

          await targetClient.focus();
          await updateBadge(0);
          return;
        } catch {
          // Try another client or open a new window below.
        }
      }

      await self.clients.openWindow(targetUrl);
      await updateBadge(0);
    })(),
  );
});

// ── Subscription Change ───────────────────────────────────────
// Browser support for pushsubscriptionchange is inconsistent.
// Handle when enough metadata is available but do not rely on it as the
// only recovery path. The page also reconciles on foreground.
self.addEventListener('pushsubscriptionchange', (event) => {
  const typedEvent = event as PushSubscriptionChangeEvent;
  // Attempt to re-subscribe and notify all clients about the new endpoint.
  // Clients will re-register with their designated server on next foreground.
  typedEvent.waitUntil(
    (async () => {
      try {
        const reg = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: null as unknown as BufferSource,
        });
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of allClients) {
          client.postMessage({
            type: 'PUSH_SUBSCRIPTION_CHANGED',
            endpoint: reg.endpoint,
          });
        }
      } catch {
        // Re-subscription failed; page-level reconciliation will handle on foreground
      }
    })(),
  );
});

export {};
