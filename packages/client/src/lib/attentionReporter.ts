import { ATTENTION_WINDOW_MS, isUserAttending, subscribeUserActivity } from '@/lib/userActivity';

/**
 * Tells a server whether someone is at this device, so it holds push
 * notifications while they are (this device signals locally). Reports every
 * change: input after a quiet spell, the window going hidden or losing
 * focus, and the attention window running out with no new input. While
 * active, the report is refreshed about once a minute so the server's copy
 * never goes stale.
 */

/** How often an unchanged "attending" is re-sent. */
export const ATTENTION_REFRESH_MS = 60_000;

export interface AttentionReportingClient {
  readonly connected: boolean;
  notifications: { reportAttention(attending: boolean): void };
  on(event: 'connected', listener: () => void): unknown;
  off(event: 'connected', listener: () => void): unknown;
}

export function attachAttentionReporter(client: AttentionReportingClient): () => void {
  let lastSent: boolean | null = null;
  let lastSentAt = 0;
  let expiry: ReturnType<typeof setTimeout> | null = null;

  const report = (): void => {
    if (!client.connected) return;
    const attending = isUserAttending();
    const now = Date.now();
    if (attending === lastSent && !(attending && now - lastSentAt >= ATTENTION_REFRESH_MS)) return;
    lastSent = attending;
    lastSentAt = now;
    client.notifications.reportAttention(attending);
  };

  // With no further input, attention lapses on its own: report that too.
  const armExpiry = (): void => {
    if (expiry !== null) clearTimeout(expiry);
    expiry = setTimeout(() => {
      expiry = null;
      report();
    }, ATTENTION_WINDOW_MS + 50);
  };

  const onActivity = (): void => {
    armExpiry();
    report();
  };
  const onConnected = (): void => {
    lastSent = null;
    report();
  };

  const unsubscribeActivity = subscribeUserActivity(onActivity);
  window.addEventListener('focus', report);
  window.addEventListener('blur', report);
  document.addEventListener('visibilitychange', report);
  client.on('connected', onConnected);
  armExpiry();
  report();

  return () => {
    if (expiry !== null) clearTimeout(expiry);
    unsubscribeActivity();
    window.removeEventListener('focus', report);
    window.removeEventListener('blur', report);
    document.removeEventListener('visibilitychange', report);
    client.off('connected', onConnected);
  };
}
