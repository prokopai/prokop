import type { AgentHandlers } from '@prokopai/agent-protocol';
import { isAgentAskId, type AgentAskPort } from '@/application/ports/agent-asks';
import { claudeApprovals } from '@/harnesses/claude-cli/approvals';
import { codexApprovals } from '@/harnesses/codex-cli/approvals';
import { getPermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';

/** Agent-side waiters for one harness's asks. */
interface AgentApprovals {
  resolve(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  hasLiveRequest(requestId: string): boolean;
}

/** Native harness ask IDs carry their harness as a prefix. */
const approvalsByPrefix: Array<[string, AgentApprovals]> = [
  ['claude-approval:', claudeApprovals],
  ['codex-approval:', codexApprovals],
];

function approvalsFor(toolCallId: string): AgentApprovals | null {
  return approvalsByPrefix.find(([prefix]) => toolCallId.startsWith(prefix))?.[1] ?? null;
}

/** Agent side of `ask.resolve`: hands the answer to the waiting harness. */
export const askResolveHandlers: AgentHandlers = {
  'ask.resolve': async ({ toolCallId, requestId, response }) =>
    ({ resolved: await approvalsFor(toolCallId)?.resolve(toolCallId, response, requestId) ?? false }),
};

/**
 * Host side. `deliver` sends the answer to the agent: a direct call in
 * process, `ask.resolve` over the protocol. The controller session comes from
 * the host's own pending-ask row; liveness from the agent's waiters (in
 * process today; from the agent connection once it is a separate process).
 */
export function createAgentAskPort(deliver: AgentAskPort['resolve']): AgentAskPort {
  const live = (requestId: string): boolean =>
    approvalsByPrefix.some(([, approvals]) => approvals.hasLiveRequest(requestId));
  return {
    owns: isAgentAskId,
    resolve: deliver,
    sessionIdFor: async (toolCallId, requestId) => {
      if (!requestId || !live(requestId)) return null;
      const row = getPermissionRequestByRequestId(requestId);
      return row && row.status === 'pending' && row.toolCallId === toolCallId ? row.rootSessionId ?? row.sessionId : null;
    },
    hasLiveRequest: live,
  };
}

/** In-process delivery. */
export const directAskDelivery: AgentAskPort['resolve'] = async ({ toolCallId, requestId, response }) =>
  await approvalsFor(toolCallId)?.resolve(toolCallId, response, requestId) ?? false;
