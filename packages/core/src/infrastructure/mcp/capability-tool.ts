import { createCapabilityTool, type CapabilityTool } from '../providers/ai-sdk';
import { mcpModelOutput, mcpOutputForCapek } from './model-output';
import { BUILTIN_VISUALS_MCP_NAME, HTML_RENDER_TOOL_NAME, parseHtmlRenderMarker } from '@prokopai/sdk';
import type { WorkspaceMcpResult, WorkspaceMcpTool } from '../../application/ports/mcp-tools';

/** The identity of an MCP tool, without its host-side `execute`. */
export type McpToolIdentity = Omit<WorkspaceMcpTool, 'execute'>;

/**
 * A tool that knows its row (the delegation tools) or a built-in render
 * (its inline page) carries that as the transcript visualization.
 */
function withVisualization(tool: McpToolIdentity, input: Record<string, unknown>, result: WorkspaceMcpResult, output: unknown): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output;
  const own = tool.visualize?.(input, result);
  if (own) return { ...output, _visualization: own };
  if (tool.serverName !== BUILTIN_VISUALS_MCP_NAME || tool.toolName !== HTML_RENDER_TOOL_NAME) return output;
  const render = parseHtmlRenderMarker(JSON.stringify(result));
  return render ? { ...output, _visualization: { type: 'html-render', title: render.title, render } } : output;
}

/**
 * Wraps an MCP tool as a capability tool: argument check, then `call`, then
 * the same output and model-output conversion. `call` runs the tool.
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
    return withVisualization(tool, input as Record<string, unknown>, result, mcpOutputForCapek(result));
  };
  converted.toModelOutput = mcpModelOutput;
  return converted;
}
