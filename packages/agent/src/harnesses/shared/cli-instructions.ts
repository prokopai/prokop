import { join } from 'node:path';
import { HTML_RENDER_TOOL_NAME, type Preconfig, type ServerMessage, type Session, type Workspace } from '@prokopai/sdk';
import { renderHtmlGuidance } from '@prokopai/core/infrastructure/visuals/render-html-guidance';
import { updateSession } from '@prokopai/core/infrastructure/storage/runtime';
import { formatAgentSkills, listAgentSkills } from './agent-skills';
import { delegationGuidance } from './delegation-guidance';
import { messagingGuidance } from './messaging-guidance';
import { cliWorkspaceMemory } from './workspace-memory';

/** Where the Claude Code and Codex drivers read preconfigs and agent homes. */
export interface CliInstructionSources {
  listPreconfigs(): Promise<Preconfig[]>;
  getPreconfig(id: string): Promise<Preconfig | null>;
  getAgentDirectory(id: string): Promise<string | null>;
  readAgentMemoryFile(id: string, filename: 'MEMORY.md' | 'USER.md'): Promise<string | null>;
}

/** What differs per CLI: who gates access outside the root, extra guidance, how to call the HTML tool. */
export interface CliInstructionWording {
  /** Completes "Access ... remains subject to". */
  accessGate: string;
  /** Added after the subagent guidance. */
  extraGuidance?: readonly string[];
  /** How this CLI calls the HTML render tool. */
  htmlToolCall: string;
  /** How this CLI calls the delegation tools. */
  delegationToolCall: string;
  /** How this CLI calls the messaging tool. */
  messagingToolCall: string;
}

/** Mirror the client's workspace default selection, including agent-home workspaces. */
export function defaultCliPreconfigId(workspace: Workspace, preconfigs: Preconfig[]): string | null {
  const primary = preconfigs.filter(item => item.mode !== 'subagent');
  const selected = workspace.settings.preconfigs?.selectedIds;
  const visible = selected?.length ? primary.filter(item => selected.includes(item.id)) : primary;
  return workspace.settings.preconfigs?.defaultId
    || (workspace.settings.isAgentHome ? workspace.settings.agentId : null)
    || visible[0]?.id || primary[0]?.id || null;
}

/**
 * The preconfig a CLI turn runs with: the session's, else the workspace
 * default. The agent home applies only when the session belongs to that agent.
 */
export async function resolveTurnPreconfig(
  session: Pick<Session, 'preconfigId' | 'agentId'>, workspace: Workspace, sources: CliInstructionSources,
  harness: 'Claude' | 'Codex',
): Promise<{ preconfigId: string; preconfig: Preconfig; agentDir: string | null }> {
  const preconfigId = session.preconfigId || defaultCliPreconfigId(workspace, await sources.listPreconfigs());
  if (!preconfigId) throw new Error(`${harness} requires a preconfig`);
  const preconfig = await sources.getPreconfig(preconfigId);
  if (!preconfig) throw new Error(`${harness} preconfig is unavailable`);
  const agentDir = session.agentId && session.agentId !== preconfigId
    ? null : await sources.getAgentDirectory(preconfigId);
  return { preconfigId, preconfig, agentDir };
}

/** A session that ran on the workspace default keeps that preconfig (and its agent) from now on. */
export async function pinDefaultPreconfig(
  session: Pick<Session, 'id' | 'preconfigId'>, preconfigId: string, agentDir: string | null,
  delivery: { broadcastToSession(sessionId: string, message: ServerMessage): void },
): Promise<void> {
  if (session.preconfigId) return;
  const updated = await updateSession(session.id, { preconfigId, agentId: agentDir ? preconfigId : null });
  if (updated) delivery.broadcastToSession(session.id, { type: 'session.updated', session: updated });
}

// Match Prokop's memory guidance without advertising its unavailable skill tools.
function agentMemoryGuidance(workspaceMemoryAvailable: boolean): string {
  return `You have personal memory that travels with you across all workspaces.

MEMORY:
${workspaceMemoryAvailable ? '- Use "memory" (workspace) for facts about THIS project (repo conventions, build commands, project-specific patterns).\n' : ''}- Use "agent_memory" (personal) for cross-project knowledge: reusable patterns, techniques, pitfalls, and user preferences that apply everywhere.
- Save to agent_memory when: you complete a complex multi-step task, the user corrects your approach, you discover a pattern useful beyond this project, or you debug through errors.

Before saving, use list to check existing entries and avoid duplicates.`;
}

const WORKSPACE_MEMORY_GUIDANCE = `You can persist durable workspace knowledge using the memory tool.
Use target="user" for user preferences and communication/workflow expectations.
Use target="memory" for workspace facts, repo conventions, commands, lessons, and non-obvious fixes.
Character limits: user=1500, workspace=2500.
Only save compact facts that should affect future sessions.
Do not save secrets, raw logs, large code, or one-off details.
If memory is full, consolidate existing entries with replace before adding.
Use the list action to verify current entries before replacing or removing.`;

/** The developer context a CLI harness adds to its own system prompt. */
export async function cliDeveloperInstructions(
  workspace: Workspace, root: string, preconfig: Preconfig, sources: CliInstructionSources,
  availableTools: readonly string[], wording: CliInstructionWording,
): Promise<string> {
  const sections: string[] = [];
  const agentDir = await sources.getAgentDirectory(preconfig.id);
  if (agentDir) {
    const home = join(agentDir, 'home');
    const memoryPath = join(agentDir, 'MEMORY.md');
    const userPath = join(agentDir, 'USER.md');
    sections.push(`<agent_home>\nHome directory: ${home}\nAgent skills directory: ${join(agentDir, 'skills')}\nAgent memory files (when present):\n- ${memoryPath}\n- ${userPath}\nAccess outside the working directory remains subject to ${wording.accessGate}.\n</agent_home>`);
    const memory = await sources.readAgentMemoryFile(preconfig.id, 'MEMORY.md');
    const user = await sources.readAgentMemoryFile(preconfig.id, 'USER.md');
    if (memory) sections.push(`<agent_memory>\n${memory}\n</agent_memory>`);
    if (user) sections.push(`<agent_user_preferences>\n${user}\n</agent_user_preferences>`);
    if (availableTools.includes('agent_memory')) {
      sections.push(agentMemoryGuidance(availableTools.includes('memory')));
    }
    const skillList = formatAgentSkills(await listAgentSkills(agentDir, root, preconfig.skills));
    if (skillList) sections.push(skillList);
    if (availableTools.includes('agent_skill_manage')) {
      sections.push('Use agent_skill_manage to list or maintain skills in the selected agent home. It does not manage workspace skills.');
    }
  }
  if (preconfig.systemPrompt) sections.push(preconfig.systemPrompt);
  sections.push('When you spawn a subagent to answer the current user request, wait for its result within this turn before reporting the result. A completed parent turn is not automatically resumed by later child activity. Do not promise a later summary after ending the turn.');
  if (availableTools.includes('delegate_task')) {
    sections.push(delegationGuidance(wording.delegationToolCall, true));
  }
  if (availableTools.includes('message_agent')) {
    sections.push(messagingGuidance(wording.messagingToolCall, true));
  }
  sections.push(...(wording.extraGuidance ?? []));
  sections.push(`<workspace>\nWorking directory: ${root}\n${workspace.additionalPaths.length
    ? `Other project directories registered with this workspace:\n${workspace.additionalPaths.map(path => `- ${path}`).join('\n')}\nAccess to these directories remains subject to ${wording.accessGate}.\n`
    : ''}</workspace>`);
  const memory = await cliWorkspaceMemory(workspace, root);
  if (memory) sections.push(memory);
  if (workspace.settings.memory?.enabled === true && availableTools.includes('memory')) {
    sections.push(WORKSPACE_MEMORY_GUIDANCE);
  }
  if (workspace.settings.sessionSearch?.enabled === true && availableTools.includes('session_search')) {
    sections.push(`Use session_search to recall past conversations when earlier work or context matters.
List recent sessions to find an ID, search by keywords, and read the relevant messages before drawing conclusions.
Prefer current_session for this conversation and workspace for other sessions in this project.
Use agent scope only for the selected agent's cross-workspace history.`);
  }
  if (availableTools.includes(HTML_RENDER_TOOL_NAME)) {
    sections.push(renderHtmlGuidance(wording.htmlToolCall));
  }
  return sections.join('\n\n');
}
