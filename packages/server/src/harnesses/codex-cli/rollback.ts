import type { MessageWithParts } from '@prokopai/sdk';
import { listMessagesWithParts } from '@/infrastructure/storage/runtime';
import { storeTransaction, type StoreTransaction } from '@/infrastructure/storage/transaction';
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

export async function getRollbackIntent(sessionId: string): Promise<RollbackIntent | null> {
  const value = await readCodexRollbackIntent(sessionId);
  if (!value) return null;
  const turns: unknown = value.turnIds;
  if (!Array.isArray(turns) || turns.some(id => typeof id !== 'string')) throw new Error('Invalid Codex rollback intent');
  return { sessionId, operation: value.operation, targetMessageId: value.targetMessageId,
    content: value.content, beforeTurnId: value.beforeTurnId, turnIds: turns, phase: value.phase };
}

export async function saveRollbackIntent(intent: RollbackIntent): Promise<void> {
  const { sessionId, ...value } = intent;
  await insertCodexRollbackIntent(sessionId, value);
}

export async function setRollbackPhase(sessionId: string, phase: RollbackIntent['phase'], tx?: StoreTransaction): Promise<void> {
  await patchCodexRollbackIntent(tx, sessionId, { phase });
}

/** The local transcript is still exactly what was read. */
function transcriptUnchanged(tx: StoreTransaction, sessionId: string, local: Array<{ message: { id: string } }>,
  error: Error): void {
  tx.check({ check: 'session.messageIds', sessionId, ids: local.map(entry => entry.message.id) }, error);
}

/** The thread is already rolled back and the edit was never resent, so its local text may still change. */
export async function retargetReadyEdit(intent: RollbackIntent, content: string): Promise<void> {
  await storeTransaction(async (tx) => {
    const current = await getRollbackIntent(intent.sessionId);
    const local = await listMessagesWithParts(intent.sessionId);
    const target = local.at(-1);
    const text = target?.parts.find(part => part.type === 'text');
    if (current?.phase !== 'ready' || current.operation !== 'edit' || current.targetMessageId !== intent.targetMessageId
      || target?.message.id !== intent.targetMessageId || !text) {
      throw new Error('Codex edit text is unavailable');
    }
    transcriptUnchanged(tx, intent.sessionId, local, new Error('Codex edit text is unavailable'));
    tx.write({ op: 'part.update', id: text.id, updates: { text: content } });
    await patchCodexRollbackIntent(tx, intent.sessionId, { content });
  });
}

export async function clearRollbackIntent(sessionId: string, tx?: StoreTransaction): Promise<void> {
  await deleteCodexRollbackIntent(tx, sessionId);
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
  const local = await listMessagesWithParts(binding.sessionId);
  const inheritedIds = new Map<string, string | null>();
  for (const entry of local) {
    if (entry.message.role === 'user') inheritedIds.set(entry.message.id, await codexInheritedUserId(entry.message.id));
  }
  const inherited = { get: (messageId: string) => {
    const upstream = inheritedIds.get(messageId);
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

export function applyRollback(intent: RollbackIntent): Promise<RevertExecutionResult> {
  return storeTransaction(async (tx) => {
    const current = await getRollbackIntent(intent.sessionId);
    if (!current || current.phase !== 'rollback') throw new Error('Codex rollback is not pending');
    const local = await listMessagesWithParts(intent.sessionId);
    const targetIndex = local.findIndex(entry => entry.message.id === intent.targetMessageId);
    const index = intent.operation === 'revert' && targetIndex > 0 ? targetIndex + 1 : targetIndex;
    if (index < 0 || local[index]?.message.role !== 'user') throw new Error('Codex rollback target disappeared');
    const result = rollbackResult(local, index, intent.operation === 'edit');
    // Rereads on a concurrent change; then the checks above decide again.
    tx.check({ check: 'native.equals', target: { harness: 'codex-cli', kind: 'rollback-intent', key: intent.sessionId },
      value: { phase: 'rollback', targetMessageId: current.targetMessageId } });
    transcriptUnchanged(tx, intent.sessionId, local, new Error('Codex rollback target disappeared'));
    if (intent.operation === 'edit') {
      const text = local[index]!.parts.find(part => part.type === 'text');
      if (!text || intent.content === null) throw new Error('Codex edit text is unavailable');
      tx.write({ op: 'part.update', id: text.id, updates: { text: intent.content } });
      // Resubmission creates a new Codex user item with this local ID.
      deleteCodexInheritedUserId(tx, local[index]!.message.id);
    }
    for (const messageId of result.removed.messageIds) tx.write({ op: 'message.delete', id: messageId });
    if (intent.operation === 'edit') await setRollbackPhase(intent.sessionId, 'ready', tx);
    else await clearRollbackIntent(intent.sessionId, tx);
    return result;
  });
}

export function sameTurns(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}
