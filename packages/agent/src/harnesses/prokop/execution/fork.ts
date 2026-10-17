import type { MessageWithParts, Session } from '@prokopai/sdk/types';
import { HARNESS_SWITCH_FORK_REASON } from '@prokopai/core/domains/sessions/harness-state';
import {
  getSession,
  getWorkspaceAutoApproveSeverity,
  listMessagesWithParts,
} from '@prokopai/core/infrastructure/storage/runtime';
import { storeTransaction } from '@prokopai/core/infrastructure/storage/transaction';
import { writeForkedSession, writeForkedTranscript } from '@prokopai/core/infrastructure/storage/fork-copy';

interface ForkOptions {
  sessionId: string;
  targetMessageId: string;
  title?: string;
}

interface ForkResult {
  forkedSession: Session;
  messages: MessageWithParts[];
}

/**
 * Copies the transcript up to and including the target into a new session in
 * one commit. The fork keeps the source's token totals and auto-approve level;
 * copied assistant messages are completed.
 */
export async function forkSession(options: ForkOptions): Promise<ForkResult> {
  const { sessionId, targetMessageId, title } = options;
  const sourceSession = await getSession(sessionId);
  if (!sourceSession) throw new Error('Source session not found');
  if (sourceSession.harnessSwitches?.length) throw new Error(HARNESS_SWITCH_FORK_REASON);

  const allMessages = await listMessagesWithParts(sessionId);
  const targetIndex = allMessages.findIndex((entry) => entry.message.id === targetMessageId);
  if (targetIndex === -1) throw new Error('Target message not found');

  const retained = allMessages.slice(0, targetIndex + 1);
  const autoApproveSeverity = sourceSession.autoApproveSeverity
    ?? await getWorkspaceAutoApproveSeverity(sourceSession.workspaceId);
  const forkedSessionId = crypto.randomUUID();
  const forkedSession = await storeTransaction((tx) => {
    const created = writeForkedSession(tx, sourceSession, {
      id: forkedSessionId, harness: 'prokop', title, metadata: sourceSession.metadata ?? {},
      extra: {
        promptTokens: sourceSession.promptTokens,
        completionTokens: sourceSession.completionTokens,
        totalTokens: sourceSession.totalTokens,
        autoApproveSeverity,
      },
    });
    writeForkedTranscript(tx, forkedSessionId, retained, () => {}, { completeAssistants: true });
    return created;
  });

  return { forkedSession: forkedSession.value, messages: await listMessagesWithParts(forkedSessionId) };
}
