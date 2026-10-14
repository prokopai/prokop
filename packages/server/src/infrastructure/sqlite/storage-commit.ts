import type { CommitCheck, CommitRequest, CommitResult, CommitWrite } from '@/infrastructure/storage/contracts';
import { CommitFailure, nativeValueMatches } from '@/infrastructure/storage/commit-guards';
import type { Message, Session } from '@prokopai/sdk/types';
import { getDatabase } from './database';
import { deleteHarnessState, getHarnessState, putHarnessState } from './harness-state';
import { createMessage, createPart, deleteMessage, listMessages, updateMessage, updatePart } from './message-store';
import { deleteQueuedMessage, getQueuedMessage } from './queued-messages';
import { createSession, getSession, updateSession } from './session-store';

/**
 * `StorageBundle.commit` on SQLite: checks, then writes, in one transaction.
 * Writes use the same store functions (and so the same FTS sync and
 * activity notices) as direct calls.
 */
export function commitSqlite(request: CommitRequest): CommitResult {
  try {
    const results = getDatabase().transaction(() => {
      (request.checks ?? []).forEach((check, index) => {
        if (!passes(check)) throw new CommitFailure('check', index);
      });
      return request.writes.map((write, index) => {
        let result: unknown;
        try { result = apply(write); }
        catch (error) { throw new CommitFailure('write', index, error instanceof Error ? error.message : String(error)); }
        if (result === null || result === false) throw new CommitFailure('write', index, `${write.op} matched no row`);
        return result;
      });
    })();
    return { ok: true, results };
  } catch (error) {
    if (error instanceof CommitFailure) {
      return { ok: false, failed: { kind: error.kind, index: error.index,
        ...(error.kind === 'write' ? { message: error.message } : {}) } };
    }
    throw error;
  }
}

function passes(check: CommitCheck): boolean {
  switch (check.check) {
    case 'native.equals': {
      const stored = getHarnessState(check.target);
      return !!stored && nativeValueMatches(stored.value, check.value);
    }
    case 'native.absent': return !getHarnessState(check.target);
    case 'session.messageIds': {
      const ids = listMessages(check.sessionId).map(message => message.id);
      return ids.length === check.ids.length && ids.every((id, index) => id === check.ids[index]);
    }
    case 'session.harness': return getSession(check.sessionId)?.harness === check.harness;
    case 'queue.present': return !!getQueuedMessage(check.id);
  }
}

function apply(write: CommitWrite): unknown {
  switch (write.op) {
    case 'session.create': return createSession(write.session);
    case 'session.update': {
      const updates = write.updates as Partial<Session>;
      if (!write.metadataPatch) return updateSession(write.id, updates);
      const current = getSession(write.id);
      return current ? updateSession(write.id, { ...updates,
        metadata: { ...(current.metadata ?? {}), ...write.metadataPatch } }) : null;
    }
    case 'message.create': return createMessage(write.message);
    case 'message.update': return updateMessage(write.id, write.updates as Partial<Message>);
    case 'message.delete': return deleteMessage(write.id) || !!write.ifExists;
    case 'part.create': return createPart(write.part, write.sessionId);
    case 'part.update': return updatePart(write.id, write.updates);
    case 'queue.delete': return deleteQueuedMessage(write.id) || !!write.ifExists;
    case 'native.put':
      putHarnessState(write.record);
      return true;
    case 'native.delete': return deleteHarnessState(write.target) || !!write.ifExists;
  }
}
