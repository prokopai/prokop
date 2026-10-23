import type { AskAuthority } from '@prokopai/sdk';
import { isNativeHarnessAskId, type AgentAskPort } from '@prokopai/core/application/ports/agent-asks';
import { builtinAsks } from '@prokopai/core/infrastructure/runtime/builtin-ask';
import { claudeApprovals } from '#agent/harnesses/claude-cli/approvals';
import { codexApprovals } from '#agent/harnesses/codex-cli/approvals';
import { prokopAskResolution } from '#agent/harnesses/prokop/composition/contracts';

/** Claude Code and Codex asks are controller-only. */
const NATIVE_AUTHORITY: AskAuthority = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' };

/** Agent-side waiters for one native harness's asks. */
interface NativeApprovals {
  getSessionId(toolCallId: string, requestId?: string): string | null;
  resolve(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  hasLiveRequest(requestId: string): boolean;
}

function nativeApprovalsFor(toolCallId: string): NativeApprovals | null {
  if (!isNativeHarnessAskId(toolCallId)) return null;
  return toolCallId.startsWith('claude-approval:') ? claudeApprovals : codexApprovals;
}

/**
 * The agent's answers: Claude/Codex approvals and the built-in asks (the
 * delegation tools) by ID prefix, everything else the Prokop permission runtime.
 */
const agentAsks: Pick<AgentAskPort, 'lookup' | 'resolve'> = {
  async lookup(toolCallId, requestId) {
    const native = nativeApprovalsFor(toolCallId);
    if (native) {
      const sessionId = native.getSessionId(toolCallId, requestId);
      return sessionId ? { sessionId, authority: NATIVE_AUTHORITY } : null;
    }
    if (builtinAsks.isBuiltinAskId(toolCallId)) {
      const sessionId = builtinAsks.getSessionId(toolCallId, requestId);
      return sessionId ? { sessionId, authority: builtinAsks.authority } : null;
    }
    const sessionId = await prokopAskResolution.getSessionIdForPendingAsk(toolCallId, requestId);
    if (!sessionId) return null;
    const authority = prokopAskResolution.getAuthorityForPendingAsk(toolCallId);
    return { sessionId, ...(authority ? { authority } : {}) };
  },
  resolve: ({ toolCallId, requestId, response }) => {
    const native = nativeApprovalsFor(toolCallId);
    if (native) return native.resolve(toolCallId, response, requestId);
    if (builtinAsks.isBuiltinAskId(toolCallId)) return builtinAsks.resolve(toolCallId, response, requestId);
    return prokopAskResolution.resolveAsk(toolCallId, response, requestId);
  },
};

/** Liveness of the waiters in this process. */
const hasLiveRequest = (requestId: string): boolean =>
  claudeApprovals.hasLiveRequest(requestId) || codexApprovals.hasLiveRequest(requestId) || builtinAsks.hasLiveRequest(requestId);

/** The host calls the agent's waiters directly. */
export const directAgentAsks: AgentAskPort = { ...agentAsks, hasLiveRequest };
