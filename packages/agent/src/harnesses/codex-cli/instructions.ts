import { HTML_RENDER_TOOL_NAME, type Preconfig, type Workspace } from '@prokopai/sdk';
import {
  cliDeveloperInstructions, defaultCliPreconfigId, type CliInstructionSources,
} from '#agent/harnesses/shared/cli-instructions';

export type CodexInstructionSources = CliInstructionSources;

/** Mirror the client's workspace default selection, including agent-home workspaces. */
export const defaultCodexPreconfigId = defaultCliPreconfigId;

/** How Codex calls the delegation tools: through its generic MCP bridge. */
export const CODEX_DELEGATION_CALL = 'Call mcp_call_tool with tool "delegate_task", "delegation_capabilities", "task_status" or "task_cancel"; mcp_list_tools shows their argument schemas';

export const CODEX_GENERATED_IMAGE_GUIDANCE = 'Images you generate with the built-in image generation tool are shown to the user inline, under the tool call, as soon as they are ready. Do not try to display, link or attach them again, and do not tell the user the image could not be shown. Empty script output after generating an image is normal; a failed generation reports an error.';

export function codexDeveloperInstructions(
  workspace: Workspace, root: string, preconfig: Preconfig, sources: CodexInstructionSources,
  availableTools: readonly string[] = [],
): Promise<string> {
  return cliDeveloperInstructions(workspace, root, preconfig, sources, availableTools, {
    accessGate: 'Codex sandbox and approvals',
    // Codex hands a generated image to the client, not to the model, so a
    // script that generates one reports empty output.
    extraGuidance: [CODEX_GENERATED_IMAGE_GUIDANCE],
    htmlToolCall: `call mcp_call_tool with tool "${HTML_RENDER_TOOL_NAME}" and arguments { html, title, height }; mcp_list_tools shows its description`,
    delegationToolCall: CODEX_DELEGATION_CALL,
  });
}
