import { HTML_RENDER_TOOL_NAME, type Preconfig, type Workspace } from '@prokopai/sdk';
import {
  cliDeveloperInstructions, defaultCliPreconfigId, type CliInstructionSources,
} from '#agent/harnesses/shared/cli-instructions';
import { claudeWorkspaceToolName } from './mcp-tools';

export type ClaudeInstructionSources = CliInstructionSources;

/** Same selection rules as Codex: workspace override, agent home, visible primary, then first primary. */
export const defaultClaudePreconfigId = defaultCliPreconfigId;

/** Build the developer context Claude Code appends to its own system prompt. */
export function claudeDeveloperInstructions(
  workspace: Workspace, root: string, preconfig: Preconfig, sources: ClaudeInstructionSources,
  availableTools: readonly string[] = [],
): Promise<string> {
  return cliDeveloperInstructions(workspace, root, preconfig, sources, availableTools, {
    accessGate: 'Prokop permission approvals',
    htmlToolCall: claudeWorkspaceToolName(HTML_RENDER_TOOL_NAME),
  });
}
