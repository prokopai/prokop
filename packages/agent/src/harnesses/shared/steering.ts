import type { Message, Part, QueuedMessage, UserMessage } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@prokopai/core/application/ports/delivery';
import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { storeTransaction, type StoreTransaction } from '@prokopai/core/infrastructure/storage/transaction';
import { attachmentContentUrl } from '@prokopai/core/domains/attachments';

/** A steer message handed to a native runtime and not yet seen in its turn. */
export interface DispatchedSteer {
  queued: QueuedMessage;
  /** Host user message id; the runtime echoes it when the message enters the turn. */
  userMessageId: string;
  images: Array<{ id: string; accessKey: string; mimeType: string }>;
}

/**
 * Steer rows a run may still dispatch, oldest first. Rows already handed to
 * the runtime stay in the queue until consumed, so a restart or a turn that
 * ends first drains them as ordinary follow-ups.
 */
export async function pendingSteers(sessionId: string, dispatched: Iterable<DispatchedSteer>): Promise<QueuedMessage[]> {
  const sent = new Set([...dispatched].map(entry => entry.queued.id));
  return (await getStorage().queue.listSteer(sessionId)).filter(row => !sent.has(row.id));
}

/**
 * Records a consumed steer message in the transcript and retires its queue row
 * in one commit. The runtime already received the content, so the message is
 * recorded even if the row was removed after dispatch. `within` adds writes to
 * the same commit, for runtime state that must move with it.
 */
export async function commitSteer(
  delivery: ApplicationDeliveryPort<unknown>, sessionId: string, steer: DispatchedSteer,
  within?: (tx: StoreTransaction) => Promise<void> | void,
): Promise<UserMessage> {
  const createdAt = Date.now();
  const { user, parts, removed } = await storeTransaction(async (tx) => {
    const removed = !!await tx.storage.queue.get(steer.queued.id);
    if (removed) {
      tx.check({ check: 'queue.present', id: steer.queued.id });
      tx.write({ op: 'queue.delete', id: steer.queued.id });
    }
    const user: UserMessage = { id: steer.userMessageId, sessionId, role: 'user', createdAt };
    tx.write({ op: 'message.create', message: user });
    const parts: Part[] = [];
    if (steer.queued.content.trim()) {
      parts.push({ id: crypto.randomUUID(), messageId: user.id, type: 'text', text: steer.queued.content, createdAt });
    }
    for (const [index, image] of steer.images.entries()) {
      parts.push({ id: crypto.randomUUID(), messageId: user.id, type: 'image',
        url: attachmentContentUrl(sessionId, image),
        mimeType: image.mimeType, createdAt: createdAt + index + 1 });
    }
    for (const part of parts) tx.write({ op: 'part.create', sessionId, part });
    await within?.(tx);
    return { user, parts, removed };
  });
  if (removed) delivery.broadcastToSession(sessionId, { type: 'queue.sending', sessionId, queueId: steer.queued.id });
  delivery.broadcastToSession(sessionId, { type: 'message.created', message: user as Message });
  for (const part of parts) delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
  return user;
}
