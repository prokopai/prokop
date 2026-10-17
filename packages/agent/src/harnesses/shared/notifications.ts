import type { Message } from '@prokopai/sdk';
import { getHarnessNotificationPort } from '@prokopai/core/application/ports/harness-notifications';
import { getSession } from '@prokopai/core/infrastructure/storage/runtime';

/** Learning reviews run as top-level sessions but are background work, never a user's chat. */
async function isLearningRun(sessionId: string): Promise<boolean> {
  return !!(await getSession(sessionId))?.metadata?.learningRunId;
}

/**
 * Push for a finished top-level reply. The notification policy decides which
 * statuses notify (completed and error) and drops child sessions.
 */
export async function notifyHarnessTurnFinished(message: Message | null | undefined): Promise<void> {
  try {
    if (message?.role !== 'assistant' || await isLearningRun(message.sessionId)) return;
    getHarnessNotificationPort()?.notifyTerminalMessage(message, message.sessionId);
  } catch (error: unknown) {
    console.warn('[harness] Completion notification failed:', error instanceof Error ? error.message : 'unknown error');
  }
}

/** Push for an approval or question the controller must answer. */
export async function notifyHarnessAnswerRequired(requestId: string, rootSessionId: string): Promise<void> {
  try {
    if (await isLearningRun(rootSessionId)) return;
    getHarnessNotificationPort()?.notifyAnswerRequired(requestId, rootSessionId);
  } catch (error: unknown) {
    console.warn('[harness] Answer notification failed:', error instanceof Error ? error.message : 'unknown error');
  }
}
