import type { PendingAskRecord } from '@prokopai/core/application/ports/session';

/**
 * Server-side observers of asks being opened, fed by the pending-asks store
 * so every harness reports through one place. A delegation waiting on a
 * child ends its wait when the child asks; an async task wakes its parent.
 */
type AskCreatedObserver = (ask: Pick<PendingAskRecord, 'sessionId' | 'requestId' | 'toolName'>) => void;
const observers = new Set<AskCreatedObserver>();

export function addAskCreatedObserver(observer: AskCreatedObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function notifyAskCreated(ask: Pick<PendingAskRecord, 'sessionId' | 'requestId' | 'toolName'>): void {
  for (const observer of observers) {
    try {
      observer(ask);
    } catch (error: unknown) {
      console.error('[sessions] Ask-created observer failed', error);
    }
  }
}
