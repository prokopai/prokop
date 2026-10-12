import type { MessageWithParts } from '@prokopai/sdk/types';
import { HARNESS_SWITCH_PRIOR_EDIT_REASON } from '@/domains/sessions/harness-state';
import { deleteMessage, getSession, listMessagesWithParts, updateMessage } from '@/infrastructure/storage/runtime';

interface RevertResult {
  revertedTo: { messageId: string | null; messageCount: number };
  removed: { messageIds: string[]; partCount: number };
}

interface RevertOptions {
  sessionId: string;
  targetMessageId: string;
  keepTarget?: boolean;
}

/**
 * True when Edit or Undo at the target would change turns from before the
 * latest harness switch. Edit rewrites its target; Undo keeps it.
 */
export async function revertCrossesHarnessSwitch(
  sessionId: string,
  targetMessageId: string,
  keepTarget: boolean,
  messages?: MessageWithParts[],
): Promise<boolean> {
  const boundaryId = (await getSession(sessionId))?.harnessSwitches?.at(-1)?.afterMessageId;
  if (!boundaryId) return false;
  const ordered = messages ?? await listMessagesWithParts(sessionId);
  const boundary = ordered.findIndex((entry) => entry.message.id === boundaryId);
  const target = ordered.findIndex((entry) => entry.message.id === targetMessageId);
  if (boundary === -1 || target < boundary) return true;
  // Undo at the first message clears the whole transcript.
  return keepTarget ? target === boundary : target === 0;
}

export async function revertToStep(options: RevertOptions): Promise<RevertResult> {
  const { sessionId, targetMessageId, keepTarget = false } = options;
  const allMessages = await listMessagesWithParts(sessionId);
  const targetIndex = allMessages.findIndex((entry) => entry.message.id === targetMessageId);
  if (targetIndex === -1) throw new Error('Target message not found');
  if (await revertCrossesHarnessSwitch(sessionId, targetMessageId, keepTarget, allMessages)) {
    throw new Error(HARNESS_SWITCH_PRIOR_EDIT_REASON);
  }

  const messagesToDelete = targetIndex === 0 && !keepTarget
    ? allMessages
    : allMessages.slice(targetIndex + 1);
  const removedMessageIds: string[] = [];
  let partCountRemoved = 0;

  for (const { message, parts } of messagesToDelete) {
    partCountRemoved += parts.length;
    removedMessageIds.push(message.id);
    await deleteMessage(message.id);
  }

  for (const { message } of await listMessagesWithParts(sessionId)) {
    if (message.role === 'assistant' && message.status === 'streaming') {
      await updateMessage(message.id, { status: 'error', error: 'Reverted before completion' });
    }
  }

  const clearedAll = targetIndex === 0 && !keepTarget;
  return {
    revertedTo: {
      messageId: clearedAll ? null : targetMessageId,
      messageCount: clearedAll ? 0 : targetIndex,
    },
    removed: { messageIds: removedMessageIds, partCount: partCountRemoved },
  };
}
