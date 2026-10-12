import { createCapabilityTool, type CapabilityTool } from '@/infrastructure/providers/ai-sdk';
import { CallToolResultSchema, type Tool as MCPToolDef } from '@modelcontextprotocol/sdk/types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getWorkspaceTools } from './manager';
import { mcpModelOutput, mcpOutputForCapek } from '@/infrastructure/mcp/model-output';
import { BUILTIN_VISUALS_MCP_NAME, HTML_RENDER_TOOL_NAME, parseHtmlRenderMarker } from '@prokopai/sdk';
import type { WorkspaceMcpResult, WorkspaceMcpTool } from '@/application/ports/mcp-tools';

/** A built-in render carries its inline page as the transcript visualization. */
function withRenderVisualization(tool: WorkspaceMcpTool, result: WorkspaceMcpResult, output: unknown): unknown {
  if (tool.serverName !== BUILTIN_VISUALS_MCP_NAME || tool.toolName !== HTML_RENDER_TOOL_NAME
    || !output || typeof output !== 'object' || Array.isArray(output)) return output;
  const render = parseHtmlRenderMarker(JSON.stringify(result));
  return render ? { ...output, _visualization: { type: 'html-render', title: render.title, render } } : output;
}

export async function getTools(path: string, sessionId: string, authorized?: () => Promise<boolean>): Promise<Record<string, CapabilityTool>> {
  return Object.fromEntries((await getWorkspaceTools(path, sessionId)).map(tool => {
    const converted = createCapabilityTool({ description: tool.description, inputSchema: tool.inputSchema,
      execute: async () => { throw new Error('MCP execution context unavailable'); } });
    converted.execute = async (input, options) => {
      if (authorized && !await authorized()) throw new Error('MCP access is not allowed for this agent');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid MCP arguments');
      const result = await tool.execute(input as Record<string, unknown>, options?.abortSignal, authorized);
      return withRenderVisualization(tool, result, mcpOutputForCapek(result));
    };
    converted.toModelOutput = mcpModelOutput;
    return [tool.name, converted];
  }));
}

type TextContent = { type: 'text'; text: string };
type ImageContent = { type: 'image'; data: string; mimeType: string };
type AudioContent = { type: 'audio'; data: string; mimeType: string };
type ResourceLinkContent = { type: 'resource_link'; uri: string; name: string };
type ResourceContent = { type: 'resource'; resource: { uri: string; text?: string; blob?: string } };
type ContentItem = TextContent | ImageContent | AudioContent | ResourceLinkContent | ResourceContent;

type McpToolResult = {
  content: ContentItem[];
  isError?: boolean;
};

export async function convertMcpTool(
  mcpTool: MCPToolDef,
  client: Client,
  serverName: string,
  timeout: number,
  _sessionId: string,
): Promise<CapabilityTool> {
  const inputSchema = mcpTool.inputSchema;
  const schema: Record<string, unknown> = {
    ...inputSchema,
    type: 'object',
    properties: inputSchema.properties ?? {},
    additionalProperties: false,
  };

  return createCapabilityTool({
    description: mcpTool.description ?? `MCP tool from ${serverName}`,
    inputSchema: schema,
    execute: async (args: unknown) => {
      const result = await client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout,
        },
      ) as McpToolResult;

      return result;
    },
  });
}

export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
