import type { MessageEvent, Part, UserMessage } from '@prokopai/sdk/types';
import { getAttachment, getNextSteerQueuedMessage } from '@/infrastructure/storage/runtime';
import { storeTransaction } from '@/infrastructure/storage/transaction';

export type SteerDeliveryEvent = MessageEvent | { type: 'queue.sending'; sessionId: string; queueId: string };

/** The user removed the row before it was claimed. */
const REMOVED = new Error('Steer message removed before delivery');

/**
 * Moves every waiting steer message into the transcript as a user message,
 * oldest first, at a settled step boundary of the running turn. Claiming the
 * queue row and writing the message and its parts is one commit, so a row the
 * user removed first is skipped and never reaches the model, and a crash
 * cannot lose a claimed message. Returns how many were delivered.
 */
export async function* deliverSteerMessages(sessionId: string): AsyncGenerator<SteerDeliveryEvent, number> {
  let delivered = 0;
  for (let next = await getNextSteerQueuedMessage(sessionId); next; next = await getNextSteerQueuedMessage(sessionId)) {
    const user: UserMessage = { id: crypto.randomUUID(), sessionId, role: 'user', createdAt: Date.now() };
    const parts: Part[] = [];
    if (next.content.trim()) {
      parts.push({ id: crypto.randomUUID(), messageId: user.id, createdAt: Date.now(), type: 'text', text: next.content });
    }
    for (const attachment of next.attachments ?? []) {
      const record = await getAttachment(sessionId, attachment.id);
      if (!record) continue;
      const url = `/api/sessions/${sessionId}/attachments/${record.id}/content?key=${record.accessKey}`;
      parts.push(record.kind === 'image'
        ? { id: crypto.randomUUID(), messageId: user.id, createdAt: Date.now(), type: 'image', url, mimeType: record.mimeType }
        : { id: crypto.randomUUID(), messageId: user.id, createdAt: Date.now(), type: 'file', url,
          mimeType: record.mimeType, filename: record.filename });
    }
    const queueId = next.id;
    const claimed = await storeTransaction((tx) => {
      tx.check({ check: 'queue.present', id: queueId }, REMOVED);
      tx.write({ op: 'queue.delete', id: queueId });
      tx.write({ op: 'message.create', message: user });
      for (const part of parts) tx.write({ op: 'part.create', sessionId, part });
    }).then(() => true, (error: unknown) => {
      if (error === REMOVED) return false;
      throw error;
    });
    if (!claimed) continue;
    yield { type: 'queue.sending', sessionId, queueId };
    yield { type: 'message.created', message: user };
    for (const part of parts) yield { type: 'part.created', sessionId, part };
    delivered++;
  }
  return delivered;
}
