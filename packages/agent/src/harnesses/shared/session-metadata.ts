import type { Session } from '@prokopai/sdk';
import type { SessionUpdates } from '@prokopai/core/infrastructure/storage/contracts';
import { getSession } from '@prokopai/core/infrastructure/storage/runtime';
import { storeTransaction } from '@prokopai/core/infrastructure/storage/transaction';

/**
 * Merges `patch` into the session's metadata in one write, so keys another
 * writer set meanwhile survive (a read, spread and write would drop them).
 * `updates` lands in the same write. Null when the session is gone, like
 * `updateSession`.
 */
export async function patchSessionMetadata(
  sessionId: string, patch: Record<string, unknown>, updates: SessionUpdates = {},
): Promise<Session | null> {
  try {
    return (await storeTransaction(tx =>
      tx.write<Session | null>({ op: 'session.update', id: sessionId, updates, metadataPatch: patch }))).value;
  } catch (error) {
    if (!await getSession(sessionId)) return null;
    throw error;
  }
}
