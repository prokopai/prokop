import type { SessionSearchDomainBridge } from '@/harnesses/shared/domain-tools';
import { getSession, getWorkspace } from '@/infrastructure/storage/runtime';
import { codexObject } from './app-server';
import type { CodexMemoryCallResult } from './memory-tools';

const fail = (message: string): CodexMemoryCallResult => ({ success: false,
  contentItems: [{ type: 'inputText', text: message }] });
const MAX_ARGUMENTS = 32_000;
const MAX_RESULT = 64_000;

/** Restrict Codex calls to the configured workspace and the active turn. */
export async function createCodexSessionSearchTools(options: {
  bridge: SessionSearchDomainBridge;
  definitions?: ReturnType<SessionSearchDomainBridge['definitions']>;
  workspaceId: string;
  sessionId: string;
  preconfigId: string;
  agentDir: string | null;
  isActive(turnId: string): boolean;
  authorizeRoot(): Promise<boolean>;
}): Promise<{ definitions: ReturnType<SessionSearchDomainBridge['definitions']>; call(raw: unknown): Promise<CodexMemoryCallResult> }> {
  const searchEnabled = (await getWorkspace(options.workspaceId))?.settings.sessionSearch?.enabled === true;
  const definitions = (options.definitions ?? options.bridge.definitions()).filter(definition =>
    definition.type === 'function' && definition.name === 'session_search' && searchEnabled);
  const seen = new Set<string>();
  const authorized = async (turnId: string): Promise<boolean> => {
    if (!options.isActive(turnId) || !await options.authorizeRoot()) return false;
    const session = await getSession(options.sessionId);
    return session?.harness === 'codex-cli' && session.workspaceId === options.workspaceId;
  };
  return {
    definitions,
    async call(raw) {
      const params = codexObject(raw);
      if (!definitions.length || !params || typeof params.turnId !== 'string'
        || params.namespace !== null || params.tool !== 'session_search'
        || typeof params.callId !== 'string' || !params.callId || params.callId.length > 256) {
        return fail('Session search unavailable');
      }
      if (seen.has(params.callId)) return fail('Duplicate session search call');
      seen.add(params.callId);
      if (!await authorized(params.turnId)) {
        seen.delete(params.callId);
        return fail('Session search unavailable');
      }
      const input = codexObject(params.arguments);
      if (!input || JSON.stringify(input).length > MAX_ARGUMENTS
        || input.action !== undefined && !['list', 'search', 'read'].includes(String(input.action))
        || input.scope !== undefined && !['current_session', 'workspace', 'agent'].includes(String(input.scope))
        || input.query !== undefined && typeof input.query !== 'string'
        || input.sessionId !== undefined && typeof input.sessionId !== 'string'
        || input.aroundMessageId !== undefined && typeof input.aroundMessageId !== 'string'
        || input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isFinite(input.limit))
        || input.window !== undefined && (typeof input.window !== 'number' || !Number.isFinite(input.window))
        || input.sort !== undefined && !['relevance', 'newest', 'oldest'].includes(String(input.sort))
        || input.roleFilter !== undefined && (!Array.isArray(input.roleFilter)
          || !input.roleFilter.every(role => ['user', 'assistant', 'tool'].includes(role)))) {
        return fail('Invalid session search arguments');
      }
      const settings = (await getWorkspace(options.workspaceId))?.settings.sessionSearch;
      if (!settings?.enabled) {
        return fail('Session search is disabled');
      }
      const agentId = options.agentDir && (await getSession(options.sessionId))?.agentId === options.preconfigId
        ? options.preconfigId : null;
      if (input.scope === 'agent' && !agentId) return fail('Agent scope requires an agent session');
      try {
        // Capability tools are always allowed when enabled; no per-write ask.
        const result = await options.bridge.execute(input, options.workspaceId, options.sessionId,
          settings.includeToolResults === true, 'none', undefined, agentId);
        const current = (await getWorkspace(options.workspaceId))?.settings.sessionSearch;
        if (!await authorized(params.turnId) || !current?.enabled
          || current.includeToolResults !== settings.includeToolResults
          || agentId !== null && (await getSession(options.sessionId))?.agentId !== agentId) {
          return fail('Session search unavailable');
        }
        const text = JSON.stringify(result.success ? result : { error: result.error ?? 'Session search failed' });
        if (text.length > MAX_RESULT) return fail('Session search result exceeds the response limit; narrow the search');
        return { success: result.success, contentItems: [{ type: 'inputText', text }] };
      } catch {
        return fail('Session search failed');
      }
    },
  };
}
