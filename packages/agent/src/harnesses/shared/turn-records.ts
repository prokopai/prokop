import type { AssistantMessage, Message, Part } from '@prokopai/sdk';
import type { SessionWirePorts } from '@prokopai/core/application/ports/delivery';
import { attachmentContentUrl } from '@prokopai/core/domains/attachments';
import type { AttachmentRecord } from '@prokopai/core/infrastructure/storage/contracts';
import { createPart } from '@prokopai/core/infrastructure/storage/runtime';

/**
 * Turn records the Claude Code and Codex drivers write the same way. Each
 * driver keeps its own order around them (queue acceptance, turn-start hooks).
 */

/** A new, empty streaming assistant message. */
export function streamingAssistant(sessionId: string, fields: {
  modelId: string; providerId: string; agent: string | null | undefined; createdAt?: number;
}): AssistantMessage {
  return { id: crypto.randomUUID(), sessionId, role: 'assistant', status: 'streaming',
    modelId: fields.modelId, providerId: fields.providerId, agent: fields.agent ?? undefined,
    tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: fields.createdAt ?? Date.now() };
}

/** The user's text part (when there is text) and one part per image, in order. */
export async function createUserTurnParts(sessionId: string, userId: string, input: {
  text: string | null; images: readonly AttachmentRecord[]; imageCreatedAt: (index: number) => number;
}): Promise<Part[]> {
  const parts: Part[] = [];
  if (input.text) {
    parts.push(await createPart({ id: crypto.randomUUID(), messageId: userId, type: 'text',
      text: input.text, createdAt: Date.now() }, sessionId));
  }
  for (const [index, image] of input.images.entries()) {
    parts.push(await createPart({ id: crypto.randomUUID(), messageId: userId, type: 'image',
      url: attachmentContentUrl(sessionId, image), mimeType: image.mimeType,
      createdAt: input.imageCreatedAt(index) }, sessionId));
  }
  return parts;
}

/** Shows the turn's user records to the session and joins the sender to it. `user` is null when it already exists. */
export function announceUserTurn<Origin>(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string,
  user: Message | null, parts: readonly Part[]): void {
  if (user) wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: user });
  for (const part of parts) wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
  wire.actor.attachOriginToSession(origin, sessionId);
}
