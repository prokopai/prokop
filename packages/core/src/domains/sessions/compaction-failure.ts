import type { AssistantMessage, TextPart } from '@prokopai/sdk/types';

/**
 * The transcript record of a failed compaction: an error assistant message
 * answering the trigger plus its text part. Written by the agent when a
 * compaction fails and by the host when recovery finds an orphaned trigger.
 */
export function compactionFailureRecord(input: {
  sessionId: string;
  triggerMessageId: string;
  error: string;
  now: number;
  messageId: string;
  partId: string;
}): { message: AssistantMessage; part: TextPart } {
  return {
    message: {
      id: input.messageId,
      sessionId: input.sessionId,
      role: 'assistant',
      status: 'error',
      modelId: '',
      providerId: '',
      tokens: { prompt: 0, completion: 0 },
      cost: 0,
      mode: 'compact_failed',
      parentId: input.triggerMessageId,
      createdAt: input.now,
      completedAt: input.now,
      error: input.error,
    },
    part: {
      id: input.partId,
      messageId: input.messageId,
      createdAt: input.now,
      type: 'text',
      text: `Compaction failed: ${input.error}`,
    },
  };
}
