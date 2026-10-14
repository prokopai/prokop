import type { PermissionGrant } from '@prokopai/sdk/tool';
import type { CreateGrantParams, MatchGrantParams, PendingAskRecord } from './host';

/**
 * Ask and grant storage for the native CLI harnesses (Claude Code, Codex).
 * Waiters, response validation and grant construction stay in the harness
 * (host/agent split, decision 6 A); this port only stores pending-ask rows
 * and grants and says who controls a session. Across the agent protocol it
 * maps onto the `interaction.*` requests Prokop's `InteractionHost` uses.
 */
export interface HarnessAskStore {
  createPendingAsk(record: Omit<PendingAskRecord, 'id'>): Promise<string>;
  expireRequest(id: string): Promise<void>;
  /**
   * Resolves a pending request and persists its remembered grant in one
   * transaction. A grant that cannot be stored denies the request.
   * `resolved` is false when the request was no longer pending.
   */
  resolveRequest(requestId: string, status: 'approved' | 'denied', resolution: unknown,
    grant?: CreateGrantParams): Promise<{ resolved: boolean; status: 'approved' | 'denied' }>;
  matchGrant(params: MatchGrantParams): Promise<{ matched: boolean; grant: PermissionGrant | null }>;
  /** `controlled`: the session has an owner, who may be offline. `connected`: that owner is online now. */
  sessionControl(sessionId: string): Promise<{ controlled: boolean; connected: boolean }>;
}

let current: HarnessAskStore | null = null;

export function configureHarnessAsks(store: HarnessAskStore): void {
  current = store;
}

export function harnessAsks(): HarnessAskStore {
  if (!current) throw new Error('Harness ask store is not configured');
  return current;
}
