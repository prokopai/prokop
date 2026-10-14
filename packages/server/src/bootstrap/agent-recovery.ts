import { reconcileAllSessionsCompaction } from '@/harnesses/prokop/host/compaction-recovery';
import { reconcileAllOrphanedToolCalls } from '@/infrastructure/sqlite/message-store';
import { cleanupAllPendingAsks, listAllPendingAsks } from '@/infrastructure/sqlite/pending-asks';
import { reconcileStuckRunningSessions } from '@/infrastructure/sqlite/session-store';
import { broadcastSessionUpdated, broadcastToSessionEvent } from '@/transport/websocket/broadcast';

/**
 * Host recovery after the agent process died. With the agent in its own
 * process every turn, waiter and compaction ran there, so whatever it left
 * running is stale: the same sweeps as startup recovery, plus the messages
 * connected clients need (open ask dialogs time out, sessions stop running).
 */
export async function recoverAfterAgentExit(): Promise<void> {
  for (const ask of listAllPendingAsks()) {
    if (ask.status !== 'pending') continue;
    const sessionId = ask.rootSessionId ?? ask.sessionId;
    broadcastToSessionEvent(sessionId, { type: 'ask.timeout', sessionId, toolCallId: ask.toolCallId, requestId: ask.requestId });
  }
  cleanupAllPendingAsks();
  const sessions = reconcileStuckRunningSessions(broadcastSessionUpdated);
  const compactions = await reconcileAllSessionsCompaction();
  const tools = reconcileAllOrphanedToolCalls();
  console.warn(`[agent] recovered after agent exit: ${sessions} running session(s), ${compactions} compaction(s), ${tools} tool call(s)`);
}
