import type { MessageWithParts } from '@prokopai/sdk';
import type { RevertExecutionResult } from '@prokopai/core/application/ports/execution';

/**
 * What a CLI rollback removes from the local transcript. `firstRemoved` is
 * the index of the user message being reverted or edited; an edit keeps that
 * message (its text is replaced) and drops everything after it.
 */
export function rollbackResult(local: MessageWithParts[], firstRemoved: number, edit: boolean): RevertExecutionResult {
  const removed = local.slice(edit ? firstRemoved + 1 : firstRemoved);
  return {
    revertedTo: {
      messageId: edit ? local[firstRemoved]!.message.id : firstRemoved ? local[firstRemoved - 1]!.message.id : null,
      messageCount: local.length - removed.length,
    },
    removed: {
      messageIds: removed.map(entry => entry.message.id),
      partCount: removed.reduce((sum, entry) => sum + entry.parts.length, 0),
    },
  };
}
