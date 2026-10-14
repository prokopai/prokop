import type { MemoryDomainBridge } from '@/harnesses/shared/domain-tools';
import { getSession, getWorkspace } from '@prokopai/core/infrastructure/storage/runtime';
import { resolveWorkspaceMemoryDir } from '@prokopai/core/infrastructure/runtime/workspace-dirs';
import { codexObject } from './app-server';

export interface CodexMemoryCallResult {
  contentItems: Array<{ type: 'inputText'; text: string }>;
  success: boolean;
}

const fail = (message: string): CodexMemoryCallResult => ({ success: false,
  contentItems: [{ type: 'inputText', text: message }] });
const MAX_ARGUMENTS = 32_000;
const MAX_RESULT = 16_000;

/** A per-turn allowlist, never the full Prokop tool catalog. */
export async function createCodexMemoryTools(options: {
  bridge: MemoryDomainBridge;
  definitions?: ReturnType<MemoryDomainBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  root: string;
  agentDir: string | null;
  isActive(turnId: string): boolean;
  authorizeRoot(): Promise<boolean>;
}): Promise<{ definitions: ReturnType<MemoryDomainBridge['definitions']>; call(raw: unknown): Promise<CodexMemoryCallResult> }> {
  const memoryEnabled = (await getWorkspace(options.workspaceId))?.settings.memory?.enabled === true;
  const definitions = (options.definitions ?? options.bridge.definitions()).filter(definition => definition.type === 'function'
    && (definition.name === 'memory' || definition.name === 'agent_memory')
    && (definition.name !== 'agent_memory' || options.agentDir !== null)
    && (definition.name !== 'memory' || memoryEnabled));
  const allowed = new Set(definitions.map(definition => definition.name));
  const seen = new Set<string>();
  const authorized = async (turnId: string): Promise<boolean> => options.isActive(turnId) && await options.authorizeRoot()
    && (await getSession(options.sessionId))?.harness === 'codex-cli';
  return {
    definitions,
    async call(raw) {
      const params = codexObject(raw);
      if (!params || typeof params.turnId !== 'string'
        || params.namespace !== null || typeof params.tool !== 'string' || !allowed.has(params.tool)
        || typeof params.callId !== 'string' || !params.callId || params.callId.length > 256) {
        return fail('Memory tool unavailable');
      }
      // Duplicated RPC calls must never repeat a mutation, even while an ask is pending.
      // Claimed before the authorization read so a concurrent duplicate is refused.
      if (seen.has(params.callId)) return fail('Duplicate memory tool call');
      seen.add(params.callId);
      if (!await authorized(params.turnId)) {
        seen.delete(params.callId);
        return fail('Memory tool unavailable');
      }
      const input = codexObject(params.arguments);
      if (!input || JSON.stringify(input).length > MAX_ARGUMENTS) return fail('Invalid memory arguments');
      const workspace = await getWorkspace(options.workspaceId);
      if (!workspace || params.tool === 'memory' && workspace.settings.memory?.enabled !== true) {
        return fail('Workspace memory is disabled');
      }
      const directory = params.tool === 'agent_memory' ? options.agentDir! : resolveWorkspaceMemoryDir(options.root);
      try {
        // Capability tools are always allowed when enabled; no per-write ask.
        const result = await options.bridge.execute(input, directory, 'none');
        if (!await authorized(params.turnId) || params.tool === 'memory'
          && (await getWorkspace(options.workspaceId))?.settings.memory?.enabled !== true) return fail('Memory tool unavailable');
        const text = JSON.stringify(result.success ? result.result : { error: result.error ?? 'Memory operation failed' });
        return { success: result.success, contentItems: [{ type: 'inputText', text: text.length <= MAX_RESULT
          ? text : `${text.slice(0, MAX_RESULT)}\n[truncated]` }] };
      } catch {
        return fail('Memory operation failed');
      }
    },
  };
}
