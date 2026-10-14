import type { MessageWithParts } from '@prokopai/sdk';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { deleteMessage, listMessagesWithParts, updatePart } from '@/infrastructure/sqlite/message-store';
import type { RevertExecutionResult } from '@/application/ports/execution';
import { CodexAppServer, codexObject } from './app-server';
import type { CodexBinding } from './bindings';
import {
  codexInheritedUserId, deleteCodexInheritedUserId, deleteCodexRollbackIntent, insertCodexRollbackIntent,
  patchCodexRollbackIntent, readCodexRollbackIntent,
} from './native-state';

export interface RollbackIntent {
  sessionId: string;
  operation: 'edit' | 'revert';
  targetMessageId: string;
  content: string | null;
  beforeTurnId: string;
  turnIds: string[];
  phase: 'rollback' | 'ready' | 'sent';
}

export function getRollbackIntent(sessionId: string): RollbackIntent | null {
  const value = readCodexRollbackIntent(sessionId);
  if (!value) return null;
  const turns: unknown = value.turnIds;
  if (!Array.isArray(turns) || turns.some(id => typeof id !== 'string')) throw new Error('Invalid Codex rollback intent');
  return { sessionId, operation: value.operation, targetMessageId: value.targetMessageId,
    content: value.content, beforeTurnId: value.beforeTurnId, turnIds: turns, phase: value.phase };
}

export function saveRollbackIntent(intent: RollbackIntent): void {
  const { sessionId, ...value } = intent;
  insertCodexRollbackIntent(sessionId, value);
}

export function setRollbackPhase(sessionId: string, phase: RollbackIntent['phase']): void {
  patchCodexRollbackIntent(sessionId, { phase });
}

/** The thread is already rolled back and the edit was never resent, so its local text may still change. */
export function retargetReadyEdit(intent: RollbackIntent, content: string): void {
  getDatabase().transaction(() => {
    const current = getRollbackIntent(intent.sessionId);
    const target = listMessagesWithParts(intent.sessionId).at(-1);
    const text = target?.parts.find(part => part.type === 'text');
    if (current?.phase !== 'ready' || current.operation !== 'edit' || current.targetMessageId !== intent.targetMessageId
      || target?.message.id !== intent.targetMessageId || !text || !updatePart(text.id, { text: content })) {
      throw new Error('Codex edit text is unavailable');
    }
    patchCodexRollbackIntent(intent.sessionId, { content });
  })();
}

export function clearRollbackIntent(sessionId: string): void {
  deleteCodexRollbackIntent(sessionId);
}

/** One Codex turn and the local messages it owns, inclusive. */
export interface CodexTurnSpan {
  id: string;
  start: number;
  end: number;
}

/**
 * A missing, truncated, or extra Codex turn must never be treated as an editable transcript.
 * A turn owns its user message and reply, followed by one user message and reply for each
 * message steered into it; each user message matches a userMessage item of that turn in order.
 */
export async function readRollbackHistory(client: CodexAppServer, binding: CodexBinding): Promise<CodexTurnSpan[]> {
  const response = codexObject(await client.request('thread/read', { threadId: binding.threadId, includeTurns: true }));
  const thread = codexObject(response?.thread);
  if (thread?.id !== binding.threadId || codexObject(thread.status)?.type !== 'idle'
    || !Array.isArray(thread.turns)) throw new Error('Codex thread history is unavailable');
  const local = listMessagesWithParts(binding.sessionId);
  const inherited = { get: (messageId: string) => {
    const upstream = codexInheritedUserId(messageId);
    return upstream ? { upstream_client_id: upstream } : null;
  } };
  const turnUsers = thread.turns.map((raw: unknown) => {
    const items = codexObject(raw)?.items;
    return Array.isArray(items) ? items.map(codexObject).filter(item => item?.type === 'userMessage') : [];
  });
  const userCount = turnUsers.reduce((count: number, users: unknown[]) => count + users.length, 0);
  if (local.length !== userCount * 2) throw new Error('Codex transcript does not match turn history');
  let cursor = 0;
  const spans = thread.turns.map((raw: unknown, index: number): CodexTurnSpan => {
    const turn = codexObject(raw);
    if (!turn || typeof turn.id !== 'string' || !turn.id || turn.itemsView !== 'full'
      || !['completed', 'failed', 'interrupted'].includes(String(turn.status)) || !Array.isArray(turn.items)
      || turnUsers[index]!.length === 0) throw new Error('Codex turn identity is incomplete');
    const start = cursor;
    for (const item of turnUsers[index]!) {
      const user = local[cursor];
      const reply = local[cursor + 1];
      if (user?.message.role !== 'user' || reply?.message.role !== 'assistant' || reply.message.status === 'streaming'
        || item?.clientId !== (inherited.get(user.message.id)?.upstream_client_id ?? user.message.id)) {
        throw new Error('Codex turn identity is incomplete');
      }
      cursor += 2;
    }
    return { id: turn.id, start, end: cursor - 1 };
  });
  if (new Set(spans.map(span => span.id)).size !== spans.length) throw new Error('Codex turn identity is ambiguous');
  return spans;
}

/** Recovery checks only the upstream IDs, not a locally inferred successful RPC response. */
export async function readTurnIds(client: CodexAppServer, threadId: string): Promise<string[]> {
  const response = codexObject(await client.request('thread/read', { threadId, includeTurns: true }));
  const thread = codexObject(response?.thread);
  if (thread?.id !== threadId || codexObject(thread.status)?.type !== 'idle' || !Array.isArray(thread.turns)) {
    throw new Error('Codex rollback history is unavailable');
  }
  const ids = thread.turns.map((raw: unknown) => {
    const turn = codexObject(raw);
    if (!turn || typeof turn.id !== 'string' || !turn.id || turn.itemsView !== 'full'
      || !['completed', 'failed', 'interrupted'].includes(String(turn.status))) {
      throw new Error('Codex rollback history is incomplete');
    }
    return turn.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('Codex rollback history is ambiguous');
  return ids;
}

export function rollbackResult(local: MessageWithParts[], targetIndex: number, edit: boolean): RevertExecutionResult {
  const removed = local.slice(edit ? targetIndex + 1 : targetIndex === 0 ? 0 : targetIndex);
  return { revertedTo: { messageId: edit ? local[targetIndex]!.message.id
    : targetIndex === 0 ? null : local[targetIndex - 1]!.message.id,
  messageCount: local.length - removed.length },
  removed: { messageIds: removed.map(entry => entry.message.id),
    partCount: removed.reduce((count, entry) => count + entry.parts.length, 0) } };
}

export function applyRollback(intent: RollbackIntent): RevertExecutionResult {
  return getDatabase().transaction(() => {
    const current = getRollbackIntent(intent.sessionId);
    if (!current || current.phase !== 'rollback') throw new Error('Codex rollback is not pending');
    const local = listMessagesWithParts(intent.sessionId);
    const targetIndex = local.findIndex(entry => entry.message.id === intent.targetMessageId);
    const index = intent.operation === 'revert' && targetIndex > 0 ? targetIndex + 1 : targetIndex;
    if (index < 0 || local[index]?.message.role !== 'user') throw new Error('Codex rollback target disappeared');
    const result = rollbackResult(local, index, intent.operation === 'edit');
    if (intent.operation === 'edit') {
      const text = local[index]!.parts.find(part => part.type === 'text');
      if (!text || intent.content === null || !updatePart(text.id, { text: intent.content })) {
        throw new Error('Codex edit text is unavailable');
      }
      // Resubmission creates a new Codex user item with this local ID.
      deleteCodexInheritedUserId(local[index]!.message.id);
    }
    for (const messageId of result.removed.messageIds) {
      if (!deleteMessage(messageId)) throw new Error('Codex transcript deletion failed');
    }
    if (intent.operation === 'edit') setRollbackPhase(intent.sessionId, 'ready');
    else clearRollbackIntent(intent.sessionId);
    return result;
  })();
}

export function sameTurns(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}
