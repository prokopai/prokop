import type { MessageEvent, Part, UserMessage } from '@prokopai/sdk/types';
import {
  createMessage,
  createPart,
  deleteQueuedMessage,
  getAttachment,
  getNextSteerQueuedMessage,
} from '@/infrastructure/storage/runtime';

export type SteerDeliveryEvent = MessageEvent | { type: 'queue.sending'; sessionId: string; queueId: string };

/**
 * Moves every waiting steer message into the transcript as a user message,
 * oldest first, at a settled step boundary of the running turn. The queue row
 * is claimed before the message is written, so a row the user removed first is
 * skipped and never reaches the model. Returns how many were delivered.
 */
export async function* deliverSteerMessages(sessionId: string): AsyncGenerator<SteerDeliveryEvent, number> {
  let delivered = 0;
  for (let next = await getNextSteerQueuedMessage(sessionId); next; next = await getNextSteerQueuedMessage(sessionId)) {
    if (!(await deleteQueuedMessage(next.id))) continue;
    yield { type: 'queue.sending', sessionId, queueId: next.id };
    const user: UserMessage = { id: crypto.randomUUID(), sessionId, role: 'user', createdAt: Date.now() };
    await createMessage(user);
    yield { type: 'message.created', message: user };
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
    for (const part of parts) {
      await createPart(part, sessionId);
      yield { type: 'part.created', sessionId, part };
    }
    delivered++;
  }
  return delivered;
}
