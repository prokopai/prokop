import type { Message, Part, QueuedMessage, UserMessage } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createMessage, createPart } from '@/infrastructure/sqlite/message-store';
import { deleteQueuedMessage, listSteerQueuedMessages } from '@/infrastructure/sqlite/queued-messages';

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
export function pendingSteers(sessionId: string, dispatched: Iterable<DispatchedSteer>): QueuedMessage[] {
  const sent = new Set([...dispatched].map(entry => entry.queued.id));
  return listSteerQueuedMessages(sessionId).filter(row => !sent.has(row.id));
}

/**
 * Records a consumed steer message in the transcript and retires its queue row
 * in one transaction. The runtime already received the content, so the
 * message is recorded even if the row was removed after dispatch. `within`
 * runs in the same transaction, for runtime state that must move with it.
 */
export function commitSteer(
  delivery: ApplicationDeliveryPort<unknown>, sessionId: string, steer: DispatchedSteer, within?: () => void,
): UserMessage {
  const db = getDatabase();
  const createdAt = Date.now();
  const { user, parts, removed } = db.transaction(() => {
    const removed = deleteQueuedMessage(steer.queued.id);
    const user = createMessage({ id: steer.userMessageId, sessionId, role: 'user', createdAt }) as UserMessage;
    const parts: Part[] = [];
    if (steer.queued.content.trim()) {
      parts.push(createPart({ id: crypto.randomUUID(), messageId: user.id, type: 'text',
        text: steer.queued.content, createdAt }, sessionId));
    }
    for (const [index, image] of steer.images.entries()) {
      parts.push(createPart({ id: crypto.randomUUID(), messageId: user.id, type: 'image',
        url: `/api/sessions/${sessionId}/attachments/${image.id}/content?key=${image.accessKey}`,
        mimeType: image.mimeType, createdAt: createdAt + index + 1 }, sessionId));
    }
    within?.();
    return { user, parts, removed };
  })();
  if (removed) delivery.broadcastToSession(sessionId, { type: 'queue.sending', sessionId, queueId: steer.queued.id });
  delivery.broadcastToSession(sessionId, { type: 'message.created', message: user as Message });
  for (const part of parts) delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
  return user;
}
