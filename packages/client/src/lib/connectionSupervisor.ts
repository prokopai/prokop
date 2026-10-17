import { queryClient } from '@/components/providers/QueryProvider';
import { useConnectionStore } from '@/stores/connectionStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import type { ProkopaiClient } from '@prokopai/sdk';

const CONNECTION_TIMEOUT = 10000;
const STALE_OPS_INTERVAL = 15000;
/**
 * An attempt older than this when the page returns to the foreground started
 * on a network the phone has since dropped; it is replaced instead of awaited.
 */
const STALE_ATTEMPT_MS = 1_000;

type ClientRef = { current: ProkopaiClient | null };

export interface ConnectionSupervisorOptions {
  serverUrl: () => string | null;
  clientRef: ClientRef;
  requestReconnect: () => void;
  cancelAttempt?: () => void;
  invalidateAllQueries?: () => void;
}

let opts: ConnectionSupervisorOptions | null = null;
let unsubscribeStore: (() => void) | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let attemptInFlight = false;
let attemptStartedAt = 0;
let attemptStartedHidden = false;

function clearWatchdog(): void {
  if (watchdogTimer !== null) clearTimeout(watchdogTimer);
  watchdogTimer = null;
}

function clearBackoff(): void {
  if (backoffTimer !== null) clearTimeout(backoffTimer);
  if (countdownInterval !== null) clearInterval(countdownInterval);
  backoffTimer = null;
  countdownInterval = null;
}

export function markConnectionAttempt(): void {
  clearWatchdog();
  clearBackoff();
  attemptInFlight = true;
  attemptStartedAt = Date.now();
  attemptStartedHidden = document.visibilityState === 'hidden';
  useConnectionStore.setState({ connected: false, authError: null, connectionTimedOut: false, nextRetryIn: 0 });
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (useConnectionStore.getState().connected) return;
    opts?.cancelAttempt?.();
    useConnectionStore.getState().setConnectionTimedOut(true);
  }, CONNECTION_TIMEOUT);
}

function requestReconnect(): void {
  if (!opts || attemptInFlight || useConnectionStore.getState().authError) return;
  clearBackoff();
  attemptInFlight = true;
  useConnectionStore.setState({ connectionTimedOut: false, nextRetryIn: 0 });
  opts.requestReconnect();
}

function startBackoff(): void {
  clearWatchdog();
  clearBackoff();
  attemptInFlight = false;
  const retryCount = useConnectionStore.getState().retryCount;
  const cap = document.visibilityState === 'hidden' ? 30_000 : 3_000;
  // Immediate first recovery; downward jitter keeps the maximum gap bounded.
  const delay = retryCount === 0 ? 0
    : Math.min(1000 * 2 ** Math.min(retryCount - 1, 5), cap) * (0.8 + Math.random() * 0.2);
  const deadline = Date.now() + delay;
  const updateCountdown = () => {
    useConnectionStore.getState().setNextRetryIn(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  };
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
  backoffTimer = setTimeout(() => {
    useConnectionStore.getState().setRetryCount(c => c + 1);
    requestReconnect();
  }, delay);
}

/** The user is watching: reconnect now and show the status without the usual grace. */
function restartNow(): void {
  useConnectionStore.setState({ retryCount: 0, foregroundRecovery: true });
  requestReconnect();
}

/**
 * Foreground return, `online`, or a network change. A socket the OS cut in
 * the background still reports open and its last server ping may be recent,
 * so a connected client is asked to answer; one that stays silent closes and
 * reconnects at once. An attempt that began while hidden, or more than a
 * second ago, is on a network that may be gone and is replaced.
 */
function recoverConnection(): void {
  if (!opts || !opts.serverUrl() || useConnectionStore.getState().authError) return;
  const client = opts.clientRef.current;
  if (client?.connected) {
    void client.probeConnection().then((alive) => {
      // The failed probe closed the socket; its close event already scheduled the
      // retry. Take it over so it runs now and shows the status.
      if (alive || !opts || attemptInFlight) return;
      restartNow();
    });
    return;
  }
  if (attemptInFlight) {
    if (!attemptStartedHidden && Date.now() - attemptStartedAt <= STALE_ATTEMPT_MS) return;
    opts.cancelAttempt?.();
    attemptInFlight = false;
  }
  restartNow();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') recoverConnection();
  else if (backoffTimer !== null) startBackoff();
}

/** Android reports wifi/cellular moves here; iOS does not expose it. */
function networkInformation(): EventTarget | null {
  const value = (navigator as Navigator & { connection?: unknown }).connection;
  return value instanceof EventTarget ? value : null;
}

export function startConnectionSupervisor(options: ConnectionSupervisorOptions): void {
  stopConnectionSupervisor();
  opts = options;
  unsubscribeStore = useConnectionStore.subscribe((curr, prev) => {
    if (curr.authError || curr.connected) {
      clearWatchdog();
      clearBackoff();
      attemptInFlight = false;
      if (curr.connected && !prev.connected) {
        if (curr.foregroundRecovery) useConnectionStore.setState({ foregroundRecovery: false });
        const invalidate = opts?.invalidateAllQueries ?? (() => queryClient.invalidateQueries());
        invalidate();
      }
      return;
    }
    if (curr.connectionTimedOut && !prev.connectionTimedOut) startBackoff();
  });
  window.addEventListener('online', recoverConnection);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  networkInformation()?.addEventListener('change', recoverConnection);
  cleanupInterval = setInterval(() => {
    usePendingOperationsStore.getState().cleanupStaleOperations();
  }, STALE_OPS_INTERVAL);
}

export function stopConnectionSupervisor(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  window.removeEventListener('online', recoverConnection);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  networkInformation()?.removeEventListener('change', recoverConnection);
  clearWatchdog();
  clearBackoff();
  if (cleanupInterval !== null) clearInterval(cleanupInterval);
  cleanupInterval = null;
  attemptInFlight = false;
  opts = null;
}
