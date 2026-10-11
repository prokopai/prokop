import { parseContextMessage, serializeContextSegments, type ContextReference } from '@prokopai/sdk';
import { loadDraft, saveDraft } from '@/config/draftStorage';

type InsertReference = (reference: ContextReference) => void;

/** Mounted composers by session; the latest mount wins when a session shows twice. */
const composers = new Map<string, InsertReference[]>();

export function registerComposer(sessionId: string, insert: InsertReference): () => void {
  const list = composers.get(sessionId) ?? [];
  list.push(insert);
  composers.set(sessionId, list);
  return () => {
    const current = composers.get(sessionId)?.filter((entry) => entry !== insert) ?? [];
    if (current.length > 0) composers.set(sessionId, current);
    else composers.delete(sessionId);
  };
}

/**
 * Adds a reference to a session's composer. Without a mounted composer the
 * reference is appended to the session's saved draft, so it is there when the
 * session opens.
 */
export function insertIntoComposer(sessionId: string, reference: ContextReference): void {
  const insert = composers.get(sessionId)?.at(-1);
  if (insert) {
    insert(reference);
    return;
  }
  const segments = parseContextMessage(loadDraft(sessionId));
  const last = segments.at(-1);
  if (last && !(last.type === 'text' && /\s$/.test(last.text))) segments.push({ type: 'text', text: ' ' });
  segments.push({ type: 'reference', reference, source: '' }, { type: 'text', text: ' ' });
  saveDraft(sessionId, serializeContextSegments(segments));
}
