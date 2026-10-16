import type { AskAuthority } from '@prokopai/sdk';
import { isNativeHarnessAskId, type AgentAskPort } from '@prokopai/core/application/ports/agent-asks';
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

/** The agent's answers: Claude/Codex approvals by ID prefix, everything else the Prokop permission runtime. */
const agentAsks: Pick<AgentAskPort, 'lookup' | 'resolve'> = {
  async lookup(toolCallId, requestId) {
    const native = nativeApprovalsFor(toolCallId);
    if (native) {
      const sessionId = native.getSessionId(toolCallId, requestId);
      return sessionId ? { sessionId, authority: NATIVE_AUTHORITY } : null;
    }
    const sessionId = await prokopAskResolution.getSessionIdForPendingAsk(toolCallId, requestId);
    if (!sessionId) return null;
    const authority = prokopAskResolution.getAuthorityForPendingAsk(toolCallId);
    return { sessionId, ...(authority ? { authority } : {}) };
  },
  resolve: ({ toolCallId, requestId, response }) => {
    const native = nativeApprovalsFor(toolCallId);
    return native ? native.resolve(toolCallId, response, requestId)
      : prokopAskResolution.resolveAsk(toolCallId, response, requestId);
  },
};

/** Liveness of native harness waiters in this process. */
const hasLiveRequest = (requestId: string): boolean =>
  claudeApprovals.hasLiveRequest(requestId) || codexApprovals.hasLiveRequest(requestId);

/** The host calls the agent's waiters directly. */
export const directAgentAsks: AgentAskPort = { ...agentAsks, hasLiveRequest };
