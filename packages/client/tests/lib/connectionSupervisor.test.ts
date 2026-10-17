import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useConnectionStore } from '@/stores/connectionStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { startConnectionSupervisor, stopConnectionSupervisor, markConnectionAttempt } from '@/lib/connectionSupervisor';
import type { ProkopaiClient } from '@prokopai/sdk';

const probe = vi.fn(async () => true);
const client = { connected: false, probeConnection: probe };
const clientRef = { current: client as unknown as ProkopaiClient };
function start(requestReconnect = vi.fn(), cancelAttempt = vi.fn(), invalidateAllQueries = vi.fn()) {
  startConnectionSupervisor({ serverUrl: () => 'http://test', clientRef, requestReconnect, cancelAttempt, invalidateAllQueries });
  return { requestReconnect, cancelAttempt, invalidateAllQueries };
}
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('connectionSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopConnectionSupervisor();
    useConnectionStore.getState().resetConnection();
    usePendingOperationsStore.setState({ operations: [] });
    client.connected = false;
    probe.mockReset().mockResolvedValue(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => {
    stopConnectionSupervisor();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('watchdog cancels the attempt after 10 seconds', () => {
    const { cancelAttempt } = start();
    markConnectionAttempt();
    vi.advanceTimersByTime(10_000);
    expect(cancelAttempt).toHaveBeenCalledTimes(1);
  });

  test('first retry is immediate and the next attempt clears the countdown', () => {
    const { requestReconnect } = start();
    useConnectionStore.getState().setConnectionTimedOut(true);
    vi.advanceTimersByTime(0);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState()).toMatchObject({ retryCount: 1, connectionTimedOut: false, nextRetryIn: 0 });
  });

  test('visible retry gaps stay below three seconds after long outages', () => {
    const { requestReconnect } = start();
    useConnectionStore.getState().setRetryCount(100);
    useConnectionStore.getState().setConnectionTimedOut(true);
    expect(useConnectionStore.getState().nextRetryIn).toBe(3);
    vi.advanceTimersByTime(2699);
    expect(requestReconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().nextRetryIn).toBe(0);
  });

  test('hidden retries back off but foreground recovery bypasses the wait', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { requestReconnect } = start();
    useConnectionStore.getState().setRetryCount(10);
    useConnectionStore.getState().setConnectionTimedOut(true);
    expect(useConnectionStore.getState().nextRetryIn).toBe(27);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(30_000);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().foregroundRecovery).toBe(true);
  });

  test('foreground keeps a young visible attempt and a connection that answers', async () => {
    const { requestReconnect, cancelAttempt } = start();
    markConnectionAttempt();
    window.dispatchEvent(new Event('online'));
    expect(requestReconnect).not.toHaveBeenCalled();
    expect(cancelAttempt).not.toHaveBeenCalled();
    useConnectionStore.getState().setConnected(true);
    client.connected = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(requestReconnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().foregroundRecovery).toBe(false);
  });

  test('foreground replaces an attempt that began while hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { requestReconnect, cancelAttempt } = start();
    markConnectionAttempt();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelAttempt).toHaveBeenCalledTimes(1);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState()).toMatchObject({ retryCount: 0, foregroundRecovery: true });
  });

  test('foreground replaces an attempt older than a second', () => {
    const { requestReconnect, cancelAttempt } = start();
    markConnectionAttempt();
    vi.advanceTimersByTime(1_500);
    window.dispatchEvent(new Event('online'));
    expect(cancelAttempt).toHaveBeenCalledTimes(1);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
  });

  test('a silent socket on foreground return reconnects at once without a second attempt', async () => {
    const { requestReconnect } = start();
    useConnectionStore.getState().setConnected(true);
    client.connected = true;
    // The transport closes the socket on a failed probe; the lifecycle then reports the drop.
    probe.mockImplementation(async () => {
      client.connected = false;
      useConnectionStore.setState({ connected: false, connectionTimedOut: true });
      return false;
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    vi.advanceTimersByTime(30_000);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState()).toMatchObject({ retryCount: 0, foregroundRecovery: true });
    useConnectionStore.getState().setConnected(true);
    expect(useConnectionStore.getState().foregroundRecovery).toBe(false);
  });

  test('a network change probes the live connection', async () => {
    const connection = new EventTarget();
    Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
    try {
      start();
      useConnectionStore.getState().setConnected(true);
      client.connected = true;
      connection.dispatchEvent(new Event('change'));
      await settle();
      expect(probe).toHaveBeenCalledTimes(1);
      stopConnectionSupervisor();
      connection.dispatchEvent(new Event('change'));
      await settle();
      expect(probe).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
    }
  });

  test('a new attempt clears stale authentication and connected state', () => {
    start();
    useConnectionStore.setState({ authError: 'Old token', connected: true });
    markConnectionAttempt();
    expect(useConnectionStore.getState()).toMatchObject({ authError: null, connected: false });
  });

  test('authentication failure stops retries including browser triggers', () => {
    const { requestReconnect, cancelAttempt } = start();
    markConnectionAttempt();
    useConnectionStore.setState({ authError: 'Invalid token', connectionTimedOut: true });
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event('online'));
    expect(requestReconnect).not.toHaveBeenCalled();
    expect(cancelAttempt).not.toHaveBeenCalled();
  });

  test('connection success invalidates once and clears timers', () => {
    const { requestReconnect, invalidateAllQueries } = start();
    useConnectionStore.getState().setConnectionTimedOut(true);
    useConnectionStore.getState().setConnected(true);
    vi.advanceTimersByTime(30_000);
    expect(invalidateAllQueries).toHaveBeenCalledTimes(1);
    expect(requestReconnect).not.toHaveBeenCalled();
  });

  test('stop clears every timer', () => {
    const { requestReconnect } = start();
    markConnectionAttempt();
    stopConnectionSupervisor();
    vi.advanceTimersByTime(30_000);
    expect(requestReconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
