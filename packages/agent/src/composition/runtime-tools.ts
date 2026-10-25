/**
 * The delegation tools as runtime tools: served to every harness through the
 * workspace MCP tool list (Claude Code's workspace MCP server, Codex's
 * mcp_call_tool, Prokop's tool catalog) without an MCP settings entry. The
 * agent's "can spawn subagents" is the only gate. An ask (an override the
 * agent may not make alone, a launch) goes through the built-in ask path,
 * the same on every harness, and carries "Allow for this agent".
 */

import { installAgentRuntimeTools, type AgentRuntimeTools } from '@prokopai/core/application/ports/runtime-tools';
import type { WorkspaceMcpResult } from '@prokopai/core/application/ports/mcp-tools';
import { askUserForBuiltin } from '@prokopai/core/infrastructure/runtime/builtin-ask';
import { getSession } from '@prokopai/core/infrastructure/runtime/host-dependencies';
import { getPreconfigOrAgent } from '#agent/harnesses/prokop/context/sources';
import { delegationDecision } from '#agent/harnesses/prokop/subagent/task-tool';
import { delegationToolDefinitions, executeDelegationTool, isDelegationTool, type HarnessEfforts } from '#agent/harnesses/prokop/subagent/tools';
import { delegationHost } from '@prokopai/core/application/ports/delegation-host';
import { harnessProbes } from '@prokopai/core/application/ports/harness-probes';
import { delegationResultFrom, delegationResultVisualization, messagingResultVisualization } from '#agent/harnesses/shared/tool-viz';
import { canMessageAnyone, executeMessagingTool, isMessagingTool, messagingToolDefinitions } from '#agent/messaging/tools';
import { groupRuntimeTools } from '#agent/groups/tools';

export const DELEGATION_TOOLS_NAME = 'Prokop Delegation';

const MAX_ARGUMENTS = 64_000;
const MAX_RESULT = 64_000;

/** The union of efforts each enabled, installed CLI harness's models support, in catalog order. */
async function harnessEfforts(): Promise<HarnessEfforts[]> {
  const host = delegationHost();
  const result: HarnessEfforts[] = [];
  for (const harness of ['codex-cli', 'claude-cli'] as const) {
    if (!host.harnessEnabled(harness) || !host.harnessAvailable(harness)) continue;
    try {
      const efforts: string[] = [];
      for (const model of await harnessProbes().models(harness)) {
        for (const effort of model.supportedEfforts) if (!efforts.includes(effort)) efforts.push(effort);
      }
      result.push({ harness, efforts });
    } catch {
      // The catalog is unavailable here; the description falls back to pointing at delegation_capabilities.
    }
  }
  return result;
}

export const delegationRuntimeTools: AgentRuntimeTools = {
  name: DELEGATION_TOOLS_NAME,
  // The delegate_task schema names the efforts each enabled CLI harness offers, from the cached catalogs.
  async definitions() {
    return delegationToolDefinitions(await harnessEfforts()).map(({ name, description, inputSchema }) =>
      ({ name, description, inputSchema: inputSchema as Record<string, unknown> }));
  },
  // Any active session whose agent may spawn subagents, whatever its harness or mode.
  async visibleTo(sessionId) {
    const session = await getSession(sessionId);
    if (!session || session.status !== 'active') return false;
    const preconfig = session.preconfigId ? await getPreconfigOrAgent(session.preconfigId) : null;
    return (preconfig?.canSpawnSubagents ?? true) !== false;
  },
  async execute(name, input, sessionId, workspacePath, signal, allowed): Promise<WorkspaceMcpResult> {
    const fail = (text: string): WorkspaceMcpResult => ({ content: [{ type: 'text', text }], isError: true });
    if (!isDelegationTool(name)) return fail('Unknown Prokop Delegation tool');
    if (JSON.stringify(input).length > MAX_ARGUMENTS) return fail(`Invalid ${name} arguments`);
    const session = await getSession(sessionId);
    if (!session || !await this.visibleTo(sessionId) || !await allowed()) return fail(`${name} unavailable`);
    const result = await executeDelegationTool(name, input, {
      sessionId, workspaceId: session.workspaceId, workspacePath, signal,
      ask: async permissionAsk => delegationDecision(await askUserForBuiltin(sessionId, name, permissionAsk, signal)),
    });
    if (!await allowed()) return fail(`${name} unavailable`);
    const text = JSON.stringify(result);
    return {
      content: [{ type: 'text', text: text.length <= MAX_RESULT ? text : `${text.slice(0, MAX_RESULT)}\n[truncated]` }],
      isError: typeof result.error === 'string' && !result.result,
    };
  },
  // Prokop renders MCP results generically; the delegation row reads the same as on the CLIs.
  visualize(name, input, result) {
    return isDelegationTool(name) ? delegationResultVisualization(name, input, delegationResultFrom(result)) : null;
  },
};

export const MESSAGING_TOOLS_NAME = 'Prokop Messaging';

/** Messaging between the user's agents: one tool, visible to any session that has someone to write to. */
export const messagingRuntimeTools: AgentRuntimeTools = {
  name: MESSAGING_TOOLS_NAME,
  definitions: (sessionId) => messagingToolDefinitions(sessionId),
  visibleTo: (sessionId) => canMessageAnyone(sessionId),
  async execute(name, input, sessionId, _workspacePath, _signal, allowed): Promise<WorkspaceMcpResult> {
    const fail = (text: string): WorkspaceMcpResult => ({ content: [{ type: 'text', text }], isError: true });
    if (!isMessagingTool(name)) return fail('Unknown Prokop Messaging tool');
    if (JSON.stringify(input).length > MAX_ARGUMENTS) return fail(`Invalid ${name} arguments`);
    if (!await this.visibleTo(sessionId) || !await allowed()) return fail(`${name} unavailable`);
    const result = await executeMessagingTool(name, input, { sessionId });
    if (!await allowed()) return fail(`${name} unavailable`);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: result.delivered !== true };
  },
  // The same row on every harness: the intent as the badge, the recipient and the message.
  visualize(name, input, result) {
    return isMessagingTool(name) ? messagingResultVisualization(input, delegationResultFrom(result)) : null;
  },
};

/** Makes the agent's runtime tools available to the host's MCP manager. */
export function installRuntimeTools(): void {
  installAgentRuntimeTools([delegationRuntimeTools, messagingRuntimeTools, groupRuntimeTools]);
}
