import type { Message, MessageWithParts, Session, SessionHarness } from '@prokopai/sdk';
import type { StoreRef, StoreTransaction } from '@prokopai/core/infrastructure/storage/transaction';

/**
 * Writes the session a CLI fork creates: same workspace, root, preconfig,
 * agent, model and permission mode as the source, active, top level.
 * `metadata` is the source metadata the fork keeps; `forkedFrom` is added.
 */
export function writeForkedSession(tx: StoreTransaction, source: Session, fork: {
  id: string; harness: SessionHarness; title?: string; metadata: Record<string, unknown>;
}): StoreRef<Session> {
  return tx.write<Session>({ op: 'session.create', session: {
    id: fork.id, workspaceId: source.workspaceId, workspaceRootId: source.workspaceRootId,
    harness: fork.harness, preconfigId: source.preconfigId,
    title: fork.title || `${source.title || 'Untitled'} (fork)`, status: 'active',
    metadata: { ...fork.metadata, forkedFrom: source.id }, parentId: null, agentName: null,
    agentId: source.agentId, selectedModel: source.selectedModel,
    selectedProvider: source.selectedProvider, permissionMode: source.permissionMode,
  } });
}

/**
 * Copies the retained transcript into the fork with fresh message and part
 * IDs (assistant parent links follow). `onUser` runs for each copied user
 * message with its new ID, in order, so the harness can map native IDs.
 */
export function writeForkedTranscript(tx: StoreTransaction, forkedSessionId: string,
  retained: readonly MessageWithParts[], onUser: (newId: string, original: Message) => void): void {
  const ids = new Map(retained.map(entry => [entry.message.id, crypto.randomUUID()]));
  for (const entry of retained) {
    const message = entry.message;
    const id = ids.get(message.id)!;
    tx.write({ op: 'message.create', message: { ...message, id, sessionId: forkedSessionId,
      ...(message.role === 'assistant' && message.parentId
        ? { parentId: ids.get(message.parentId) } : {}) } });
    if (message.role === 'user') onUser(id, message);
    for (const part of entry.parts) {
      tx.write({ op: 'part.create', sessionId: forkedSessionId, part: { ...part, id: crypto.randomUUID(), messageId: id } });
    }
  }
}
