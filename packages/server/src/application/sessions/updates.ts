import type { Session } from '@prokopai/sdk';

/**
 * Server-side observers of session row updates, fed by the session store so
 * every harness and every path (turn start and end, compaction, archive)
 * reports through one place. Consumers react to transitions they care
 * about, for example pending deliveries waiting for an idle session.
 */
type SessionUpdatedObserver = (session: Session) => void;
const observers = new Set<SessionUpdatedObserver>();

export function addSessionUpdatedObserver(observer: SessionUpdatedObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function notifySessionUpdated(session: Session): void {
  for (const observer of observers) {
    try {
      observer(session);
    } catch (error: unknown) {
      console.error('[sessions] Session-updated observer failed', error);
    }
  }
}
