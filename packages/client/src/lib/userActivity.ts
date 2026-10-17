/**
 * Whether you are actually at this device. A focused window is not enough:
 * macOS keeps a frontmost browser window visible and focused with the
 * display asleep or the screen locked, and a desktop left like that would
 * silence every other device. Recent input is the extra signal.
 */

/** Input older than this no longer counts as being at the device. */
export const ATTENTION_WINDOW_MS = 2 * 60 * 1000;

let lastInputAt = 0;
let installed = false;
const listeners = new Set<() => void>();

/** Records input now. Exposed for tests and for synthetic activity (a launch). */
export function markUserActivity(now: number = Date.now()): void {
  lastInputAt = now;
  for (const listener of listeners) listener();
}

/** Runs on every recorded input until unsubscribed. */
export function subscribeUserActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function hasRecentUserInput(now: number = Date.now(), windowMs: number = ATTENTION_WINDOW_MS): boolean {
  return now - lastInputAt <= windowMs;
}

/** Visible, focused, and touched within the attention window. */
export function isUserAttending(now: number = Date.now()): boolean {
  return document.visibilityState === 'visible' && document.hasFocus() && hasRecentUserInput(now);
}

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Starts tracking input. Opening the page, returning to the tab, and
 * focusing the window count as input too: they are deliberate actions.
 */
export function installUserActivityTracking(): () => void {
  if (installed) return () => {};
  installed = true;
  markUserActivity();
  const onInput = () => markUserActivity();
  const onVisible = () => { if (document.visibilityState === 'visible') markUserActivity(); };
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: true });
  window.addEventListener('focus', onInput);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    installed = false;
    for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
    window.removeEventListener('focus', onInput);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Test seam: forget all recorded input. */
export function resetUserActivityForTests(): void {
  lastInputAt = 0;
}
