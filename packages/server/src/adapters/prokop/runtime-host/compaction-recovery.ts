/**
 * Wires Capek compaction recovery to Jean2's SQLite repositories and server
 * broadcast adapters. Reconciliation decisions remain in the Capek domain.
 */

import {
  reconcileAllSessionsCompaction as reconcileAllSessionsWithDeps, reconcileSessionCompaction as reconcileSessionWithDeps, type CompactionRecoveryDeps, mapCapekEventToServerMessage,
} from '@/agent';
import type { RuntimeEventSink } from '@prokopai/core/infrastructure/runtime/events';
import type { CompactionRecoveryPort } from '@prokopai/core/application/ports/session';
import {
  broadcastEvent,
  broadcastSessionUpdated,
  type BroadcastSessionFn,
} from '@/transport/websocket/broadcast';
import { createMessage, createPart, findOrphanedCompactionTriggers } from '@/infrastructure/sqlite/message-store';
import { compactionFailureRecord } from '@prokopai/core/domains/sessions/compaction-failure';
import { getSession, listSessions, updateSession } from '@/infrastructure/sqlite/session-store';

export interface ReconcileOptions {
  broadcast?: boolean;
}

function buildCompactionRecoveryDeps(): CompactionRecoveryDeps & CompactionRecoveryPort {
  const broadcastFn: RuntimeEventSink = (event) => {
    const message = mapCapekEventToServerMessage(event);
    if (message) broadcastEvent(message);
  };
  const broadcastSessUpdate: BroadcastSessionFn = broadcastSessionUpdated;

  return {
    // Callers reconcile only idle sessions: at startup, and on session open
    // when the host sees no live execution (which counts a running compaction).
    isWorkActive: () => false,
    async persistFailure(sessionId, triggerMessageId, error, broadcast) {
      const { message, part } = compactionFailureRecord({ sessionId, triggerMessageId, error, now: Date.now(),
        messageId: crypto.randomUUID(), partId: crypto.randomUUID() });
      createMessage(message);
      createPart(part, sessionId);
      broadcast({ kind: 'message', action: 'created', message });
      broadcast({ kind: 'part', action: 'created', sessionId, part });
    },
    isSessionCompacting(sessionId: string): boolean {
      return getSession(sessionId)?.compacting === true;
    },
    clearSessionCompacting(sessionId: string) {
      updateSession(sessionId, { compacting: false });
      return getSession(sessionId);
    },
    listOrphanedCompactionTriggers(sessionId: string) {
      return findOrphanedCompactionTriggers(sessionId);
    },
    listSessionIds(): string[] {
      return listSessions().map((session) => session.id);
    },
    broadcast: broadcastFn,
    broadcastSessionUpdated: broadcastSessUpdate,
  };
}

export async function reconcileSessionCompaction(
  sessionId: string,
  options: ReconcileOptions = {},
): Promise<number> {
  return reconcileSessionWithDeps(sessionId, buildCompactionRecoveryDeps(), options);
}

export async function reconcileAllSessionsCompaction(): Promise<number> {
  return reconcileAllSessionsWithDeps(buildCompactionRecoveryDeps());
}
