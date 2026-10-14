import type { CapabilityTool } from '@prokopai/core/infrastructure/providers/ai-sdk';
import type { Tool as MCPToolDef } from '@modelcontextprotocol/sdk/types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getWorkspaceTools } from './manager';

export async function getTools(path: string, sessionId: string, authorized?: () => Promise<boolean>): Promise<Record<string, CapabilityTool>> {
  // AI SDK tools are for the in-process Prokop runtime; they (and the MCP SDK) load with the first conversion.
  const { capabilityToolFromMcp } = await import('@prokopai/core/infrastructure/mcp/capability-tool');
  return Object.fromEntries((await getWorkspaceTools(path, sessionId)).map(tool => [tool.name, capabilityToolFromMcp(tool, {
    authorized,
    call: (input, signal) => tool.execute(input, signal, authorized),
  })]));
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

  const { createCapabilityTool } = await import('@prokopai/core/infrastructure/providers/ai-sdk');
  const { CallToolResultSchema } = await import('@modelcontextprotocol/sdk/types.js');
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
