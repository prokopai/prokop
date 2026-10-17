/**
 * A finished run announces itself twice: `message.updated` (to clients that
 * opened the session) and then `session.updated` with the running mark
 * cleared (to everyone). The first carries the result and is handled in
 * full; the second is the only word a session that is not open here gets.
 * This keeps the two from both sounding for one finish.
 */

/** How long after the message path a run end is treated as already handled. */
export const FINISH_SIGNAL_WINDOW_MS = 10_000;

const handledAt = new Map<string, number>();

export function markFinishHandled(sessionId: string, now: number = Date.now()): void {
  handledAt.set(sessionId, now);
  if (handledAt.size > 500) {
    const oldest = handledAt.keys().next().value;
    if (oldest !== undefined) handledAt.delete(oldest);
  }
}

export function wasFinishHandledRecently(sessionId: string, now: number = Date.now()): boolean {
  const at = handledAt.get(sessionId);
  return at !== undefined && now - at <= FINISH_SIGNAL_WINDOW_MS;
}

export function resetFinishSignalsForTests(): void {
  handledAt.clear();
}
