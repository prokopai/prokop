import type { CodexModel, CodexModelSelection } from '@prokopai/sdk';
import { readCodexModelSelection } from './native-state';
import { CodexAppServer, codexObject, spawnCodexAppServer, type CodexConnection } from './app-server';
import { codexCliVersion } from './version';

export interface CodexModelDependencies {
  connect(): CodexConnection;
  version(): string;
}

const defaultDependencies: CodexModelDependencies = { connect: spawnCodexAppServer, version: codexCliVersion };

/** The model and effort the host saved for this session (host-owned, read at turn start). */
export function getCodexModelSelection(sessionId: string): Promise<CodexModelSelection | null> {
  return readCodexModelSelection(sessionId);
}

/** Fetch only the host CLI catalog. Never fall back to Prokop provider models. */
export async function listCodexModels(deps: CodexModelDependencies = defaultDependencies): Promise<CodexModel[]> {
  deps.version();
  const client = new CodexAppServer(deps.connect(), () => {});
  try {
    await client.initialize();
    const models: CodexModel[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const response = codexObject(await client.request('model/list', {
        limit: 100, ...(cursor ? { cursor } : {}),
      }));
      if (!response || !Array.isArray(response.data)) throw new Error('Invalid Codex model catalog');
      for (const raw of response.data) {
        const entry = codexObject(raw);
        if (!entry || entry.hidden === true) continue;
        const model = entry.model;
        const efforts = entry.supportedReasoningEfforts;
        if (typeof model !== 'string' || !model || typeof entry.displayName !== 'string'
          || !Array.isArray(efforts) || typeof entry.defaultReasoningEffort !== 'string') {
          throw new Error('Invalid Codex model catalog');
        }
        const supportedEfforts = efforts.map(option => {
          const effort = codexObject(option)?.reasoningEffort;
          if (typeof effort !== 'string' || !effort) throw new Error('Invalid Codex reasoning effort');
          return effort;
        });
        if (!supportedEfforts.includes(entry.defaultReasoningEffort) || seen.has(model)) {
          throw new Error('Invalid Codex model catalog');
        }
        seen.add(model);
        models.push({ model, name: entry.displayName, supportedEfforts,
          defaultEffort: entry.defaultReasoningEffort, isDefault: entry.isDefault === true });
      }
      if (response.nextCursor === null) return models;
      if (typeof response.nextCursor !== 'string' || !response.nextCursor || response.nextCursor === cursor) {
        throw new Error('Invalid Codex model cursor');
      }
      cursor = response.nextCursor;
    }
    throw new Error('Codex model catalog exceeds page limit');
  } finally {
    await client.close();
  }
}

/** Listing spawns a Codex app-server process; callers share one catalog per TTL window. */
const CATALOG_TTL_MS = 10 * 60_000;

export function createCodexModelCatalogCache(
  list: () => Promise<CodexModel[]> = listCodexModels,
  ttlMs: number = CATALOG_TTL_MS,
): () => Promise<CodexModel[]> {
  let cache: { at: number; promise: Promise<CodexModel[]> } | null = null;
  return () => {
    if (!cache || Date.now() - cache.at > ttlMs) {
      const promise = list().catch((err: unknown) => {
        // Clear only our own entry; a newer probe may already be cached.
        if (cache?.promise === promise) cache = null;
        throw err;
      });
      cache = { at: Date.now(), promise };
    }
    return cache.promise;
  };
}

const cachedCodexModels = createCodexModelCatalogCache();

/** Catalog over the shared spawn cache. */
export function listCachedCodexModels(): Promise<CodexModel[]> {
  return cachedCodexModels();
}
