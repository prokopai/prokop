/**
 * The group chat tools a member session gets, served through the workspace
 * MCP tool list as the Prokop Group Chat built-in on every harness:
 * `group_history` reads the group thread beyond the catch-up, and
 * `handoff_to_agent` passes a distinct next stage to another member. Only a
 * member session sees them; everything runs on the host's installed service.
 */

import type { AgentRuntimeTools } from '@prokopai/core/application/ports/runtime-tools';
import type { WorkspaceMcpResult } from '@prokopai/core/application/ports/mcp-tools';
import { agentGroups } from '@prokopai/core/application/ports/agent-groups';
import { GROUP_HANDOFF_MAX_LENGTH, GROUP_HISTORY_DEFAULT_LIMIT, GROUP_HISTORY_MAX_LIMIT } from '@prokopai/core/application/groups/service';
import { getSession } from '@prokopai/core/infrastructure/storage/runtime';
import { delegationResultFrom, groupResultVisualization, GROUP_TOOL_NAMES, isGroupToolName, type GroupToolName } from '#agent/harnesses/shared/tool-viz';

export { GROUP_TOOL_NAMES, type GroupToolName };
export const GROUP_TOOLS_NAME = 'Prokop Group Chat';

const MAX_ARGUMENTS = 64_000;

type Definition = { name: string; description: string; inputSchema: Record<string, unknown> };

async function definitions(sessionId: string): Promise<Definition[]> {
  const membership = await agentGroups()?.memberOf(sessionId);
  if (!membership) return [];
  const others = membership.others.map((other) => `- ${other.agentId} (${other.name})${other.description ? `: ${other.description}` : ''}`);
  return [
    {
      name: 'group_history',
      description: `Read older messages of the group chat "${membership.group.name}" you are in: the ones a catch-up omitted, or anything before it. Messages come back labeled with their author ([Name], [User] for the person), oldest first, with has_more. Reading never changes what you are sent next. Give before_seq or after_seq, not both; neither reads the newest messages.`,
      inputSchema: {
        type: 'object',
        properties: {
          before_seq: { type: 'integer', minimum: 0, description: 'Read the messages just before this position (a catch-up names the position it starts at).' },
          after_seq: { type: 'integer', minimum: 0, description: 'Read the messages just after this position.' },
          limit: { type: 'integer', minimum: 1, maximum: GROUP_HISTORY_MAX_LIMIT, description: `How many, default ${GROUP_HISTORY_DEFAULT_LIMIT}, at most ${GROUP_HISTORY_MAX_LIMIT}.` },
        },
      },
    },
    {
      name: 'handoff_to_agent',
      description: `Transfer a genuinely distinct next stage of the work to another member of the group chat "${membership.group.name}". It posts a visible handoff in the group and wakes that member with your message. One member owns each stage: never hand off to yourself and never bounce a stage back and forth. Writing "@Name" in your reply wakes nobody; only this tool does. Your own turn's final text still posts to the group.\n\nMembers you can hand off to:\n${others.join('\n') || '- none'}`,
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'One of the member ids listed above.' },
          message: { type: 'string', description: `What the next stage needs, up to ${GROUP_HANDOFF_MAX_LENGTH} characters. The member also receives the group messages it has not seen; include anything else it needs (paths, decisions).` },
        },
        required: ['agent_id', 'message'],
      },
    },
  ];
}

/** Group chat for member sessions: history beyond the catch-up and handoffs. */
export const groupRuntimeTools: AgentRuntimeTools = {
  name: GROUP_TOOLS_NAME,
  definitions,
  async visibleTo(sessionId) {
    const service = agentGroups();
    if (!service) return false;
    const session = await getSession(sessionId);
    if (!session || session.status !== 'active') return false;
    return (await service.memberOf(sessionId)) !== null;
  },
  async execute(name, input, sessionId, _workspacePath, _signal, allowed): Promise<WorkspaceMcpResult> {
    const fail = (text: string): WorkspaceMcpResult => ({ content: [{ type: 'text', text }], isError: true });
    const service = agentGroups();
    if (!service || !isGroupToolName(name)) return fail('Unknown Prokop Group Chat tool');
    if (JSON.stringify(input).length > MAX_ARGUMENTS) return fail(`Invalid ${name} arguments`);
    if (!await this.visibleTo(sessionId) || !await allowed()) return fail(`${name} unavailable`);
    const result = name === 'group_history'
      ? await service.history(sessionId, input)
      : await service.handoff(sessionId, input);
    if (!await allowed()) return fail(`${name} unavailable`);
    const body = result.ok ? { ok: true, ...result.value } : { ok: false, code: result.code, error: result.error };
    return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: !result.ok };
  },
  visualize(name, input, result) {
    return isGroupToolName(name) ? groupResultVisualization(name, input, delegationResultFrom(result)) : null;
  },
};
