import { createCapabilityTool, type CapabilityTool } from '@/infrastructure/providers/ai-sdk';
import { CallToolResultSchema, type Tool as MCPToolDef } from '@modelcontextprotocol/sdk/types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getWorkspaceTools } from './manager';
import { capabilityToolFromMcp } from '@/infrastructure/mcp/capability-tool';

export async function getTools(path: string, sessionId: string, authorized?: () => Promise<boolean>): Promise<Record<string, CapabilityTool>> {
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
