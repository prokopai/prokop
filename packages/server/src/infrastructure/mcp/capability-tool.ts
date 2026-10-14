import { createCapabilityTool, type CapabilityTool } from '@/infrastructure/providers/ai-sdk';
import { mcpModelOutput, mcpOutputForCapek } from '@/infrastructure/mcp/model-output';
import { BUILTIN_VISUALS_MCP_NAME, HTML_RENDER_TOOL_NAME, parseHtmlRenderMarker } from '@prokopai/sdk';
import type { WorkspaceMcpResult, WorkspaceMcpTool } from '@/application/ports/mcp-tools';

/** The identity of an MCP tool, without its host-side `execute`. */
export type McpToolIdentity = Omit<WorkspaceMcpTool, 'execute'>;

/** A built-in render carries its inline page as the transcript visualization. */
function withRenderVisualization(tool: McpToolIdentity, result: WorkspaceMcpResult, output: unknown): unknown {
  if (tool.serverName !== BUILTIN_VISUALS_MCP_NAME || tool.toolName !== HTML_RENDER_TOOL_NAME
    || !output || typeof output !== 'object' || Array.isArray(output)) return output;
  const render = parseHtmlRenderMarker(JSON.stringify(result));
  return render ? { ...output, _visualization: { type: 'html-render', title: render.title, render } } : output;
}

/**
 * Wraps an MCP tool as a capability tool: argument check, then `call`, then
 * the same output and model-output conversion. In-process `call` runs the
 * tool; across the agent protocol it is a `tool.call` request.
 */
export function capabilityToolFromMcp(tool: McpToolIdentity, options: {
  authorized?: () => Promise<boolean>;
  call(input: Record<string, unknown>, signal?: AbortSignal): Promise<WorkspaceMcpResult>;
}): CapabilityTool {
  const converted = createCapabilityTool({ description: tool.description, inputSchema: tool.inputSchema,
    execute: async () => { throw new Error('MCP execution context unavailable'); } });
  converted.execute = async (input, executeOptions) => {
    if (options.authorized && !await options.authorized()) throw new Error('MCP access is not allowed for this agent');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid MCP arguments');
    const result = await options.call(input as Record<string, unknown>, executeOptions?.abortSignal);
    return withRenderVisualization(tool, result, mcpOutputForCapek(result));
  };
  converted.toModelOutput = mcpModelOutput;
  return converted;
}
