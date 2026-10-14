import type { CodexContextUsage, CodexTokenBreakdown } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@prokopai/core/application/ports/delivery';
import { getSession, updateSession } from '@prokopai/core/infrastructure/storage/runtime';
import { codexObject } from './app-server';

const FIELDS = ['totalTokens', 'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens',
  'outputTokens', 'reasoningOutputTokens'] as const;

function breakdown(value: unknown): CodexTokenBreakdown | null {
  const record = codexObject(value);
  if (!record || FIELDS.some(field => typeof record[field] !== 'number'
    || !Number.isSafeInteger(record[field]) || record[field] < 0)) {
    return null;
  }
  return Object.fromEntries(FIELDS.map(field => [field, record[field]])) as unknown as CodexTokenBreakdown;
}

export function parseCodexContextUsage(value: unknown): CodexContextUsage | null {
  const record = codexObject(value);
  if (!record) return null;
  const last = breakdown(record.last);
  const total = breakdown(record.total);
  const window = record.modelContextWindow;
  if (!last || !total || (window !== null && (typeof window !== 'number'
    || !Number.isSafeInteger(window) || window <= 0))) return null;
  return { last, total, modelContextWindow: window };
}

export async function publishCodexContextUsage(sessionId: string, usage: CodexContextUsage,
  delivery: ApplicationDeliveryPort<unknown>): Promise<void> {
  const session = await getSession(sessionId);
  if (session?.harness !== 'codex-cli') return;
  const updated = await updateSession(sessionId, { metadata: { ...(codexObject(session.metadata) ?? {}), codexUsage: usage } });
  if (updated) delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
}
