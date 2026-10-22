import { getSession } from '@prokopai/core/infrastructure/storage/runtime';
import type { PermissionAsk } from '@prokopai/sdk/types';
import { DELEGATION_TOOL_NAMES, type DelegationDomainBridge } from '#agent/harnesses/shared/domain-tools';
import { codexObject } from './app-server';
import type { CodexMemoryCallResult } from './memory-tools';

const MAX_ARGUMENTS = 64_000;
const MAX_RESULT = 64_000;

const fail = (message: string): CodexMemoryCallResult => ({ success: false,
  contentItems: [{ type: 'inputText', text: message }] });

/** The delegation tools as Codex dynamic tools for one turn. */
export function createCodexDelegationTools(options: {
  bridge: DelegationDomainBridge;
  definitions?: ReturnType<DelegationDomainBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  root: string;
  preconfigId: string;
  isActive(turnId: string): boolean;
  authorizeRoot(): Promise<boolean>;
  /** Asks the user through the Codex approval path (a free target, a launch). */
  ask?: (ask: PermissionAsk) => Promise<boolean>;
}): { definitions: ReturnType<DelegationDomainBridge['definitions']>; call(raw: unknown): Promise<CodexMemoryCallResult> } {
  const definitions = (options.definitions ?? options.bridge.definitions())
    .filter(definition => definition.type === 'function' && (DELEGATION_TOOL_NAMES as readonly string[]).includes(definition.name));
  const allowed = new Set(definitions.map(definition => definition.name));
  const seen = new Set<string>();
  const authorized = async (turnId: string): Promise<boolean> => {
    if (!options.isActive(turnId) || !await options.authorizeRoot()) return false;
    const session = await getSession(options.sessionId);
    return session?.harness === 'codex-cli' && session.status === 'active'
      && session.workspaceId === options.workspaceId && session.preconfigId === options.preconfigId;
  };
  const context = { sessionId: options.sessionId, workspaceId: options.workspaceId, workspacePath: options.root,
    ...(options.ask ? { ask: options.ask } : {}) };
  return {
    definitions,
    async call(raw) {
      const params = codexObject(raw);
      if (!params || typeof params.turnId !== 'string' || params.namespace !== null
        || typeof params.tool !== 'string' || !allowed.has(params.tool)
        || typeof params.callId !== 'string' || !params.callId || params.callId.length > 256) {
        return fail('Delegation tool unavailable');
      }
      // A duplicated RPC call must never start a second child.
      if (seen.has(params.callId)) return fail('Duplicate delegation tool call');
      seen.add(params.callId);
      if (!await authorized(params.turnId)) {
        seen.delete(params.callId);
        return fail('Delegation tool unavailable');
      }
      const input = codexObject(params.arguments) ?? {};
      if (JSON.stringify(input).length > MAX_ARGUMENTS) return fail('Invalid delegation arguments');
      try {
        const result = params.tool === 'delegate_task' ? await options.bridge.delegate(input, context)
          : params.tool === 'delegation_capabilities' ? await options.bridge.capabilities(input, context)
            : params.tool === 'task_status' ? await options.bridge.status(input, context)
              : await options.bridge.cancel(input, context);
        const text = JSON.stringify(result);
        return { success: !(typeof result.error === 'string' && !result.result),
          contentItems: [{ type: 'inputText', text: text.length <= MAX_RESULT ? text : `${text.slice(0, MAX_RESULT)}\n[truncated]` }] };
      } catch (error: unknown) {
        return fail(error instanceof Error ? error.message : 'Delegation failed');
      }
    },
  };
}
