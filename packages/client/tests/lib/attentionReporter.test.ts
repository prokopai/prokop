import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ATTENTION_REFRESH_MS, attachAttentionReporter, type AttentionReportingClient } from '@/lib/attentionReporter';
import { ATTENTION_WINDOW_MS, markUserActivity, resetUserActivityForTests } from '@/lib/userActivity';

function makeClient(connected = true) {
  const listeners = new Set<() => void>();
  const reports: boolean[] = [];
  const client: AttentionReportingClient & { reports: boolean[]; connected: boolean; emitConnected(): void } = {
    connected,
    reports,
    notifications: { reportAttention: (attending) => { reports.push(attending); } },
    on: (_event, listener) => { listeners.add(listener); },
    off: (_event, listener) => { listeners.delete(listener); },
    emitConnected: () => { for (const listener of listeners) listener(); },
  };
  return client;
}

describe('attention reporter', () => {
  let detach: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    resetUserActivityForTests();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    detach();
    detach = () => {};
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('reports the current state at attach, then only changes, then a lapse with no input', () => {
    markUserActivity();
    const client = makeClient();
    detach = attachAttentionReporter(client);
    expect(client.reports).toEqual([true]);

    // More input inside the refresh interval is not re-sent.
    vi.advanceTimersByTime(10_000);
    markUserActivity();
    expect(client.reports).toEqual([true]);

    // No input for the whole window: attention lapses and the server hears it.
    vi.advanceTimersByTime(ATTENTION_WINDOW_MS + 100);
    expect(client.reports).toEqual([true, false]);

    // Back at the keyboard.
    markUserActivity();
    expect(client.reports).toEqual([true, false, true]);
  });

  test('an unchanged "attending" is refreshed about once a minute while input continues', () => {
    markUserActivity();
    const client = makeClient();
    detach = attachAttentionReporter(client);
    vi.advanceTimersByTime(ATTENTION_REFRESH_MS + 1);
    markUserActivity();
    expect(client.reports).toEqual([true, true]);
  });

  test('losing focus or going hidden reports absence; reconnecting repeats the state', () => {
    markUserActivity();
    const client = makeClient();
    detach = attachAttentionReporter(client);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    expect(client.reports).toEqual([true, false]);

    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(client.reports).toEqual([true, false, true]);

    // A new socket knows nothing: the state is sent again.
    client.emitConnected();
    expect(client.reports).toEqual([true, false, true, true]);
  });

  test('nothing is sent while disconnected, and nothing after detach', () => {
    markUserActivity();
    const client = makeClient(false);
    detach = attachAttentionReporter(client);
    markUserActivity();
    expect(client.reports).toEqual([]);
    client.connected = true;
    client.emitConnected();
    expect(client.reports).toEqual([true]);
    detach();
    detach = () => {};
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    expect(client.reports).toEqual([true]);
  });
});
