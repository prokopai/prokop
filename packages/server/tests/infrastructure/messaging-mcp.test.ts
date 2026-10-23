/**
 * Messaging is a built-in like delegation: the MCP manager appends
 * `message_agent` to the workspace tool list of any active session that has
 * an agent to write to, on every harness, without an MCP settings entry.
 * The description names the agents the caller may message; a call runs the
 * shared service and reports its typed refusal.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Session, SessionHarness } from '@prokopai/sdk';
import { createMemoryAgentConversationStore, installAgentMessagingHost } from '@prokopai/core/application/ports/agent-messaging';
import { installAgentRuntimeTools } from '@prokopai/core/application/ports/runtime-tools';
import { createPreconfig } from '@prokopai/core/infrastructure/config/preconfig';
import { Paths } from '@prokopai/core/infrastructure/runtime/paths';
import { MESSAGING_TOOLS_NAME, messagingRuntimeTools } from '@prokopai/agent/internal/composition/runtime-tools';
import { createClaudeWorkspaceMcp } from '@prokopai/agent/internal/harnesses/claude-cli/mcp-tools';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { createMcpManager } from '@/infrastructure/mcp/manager';

let root: string;
let manager: ReturnType<typeof createMcpManager>;
let deliveries: Array<{ sessionId: string; content: string; key: string }>;

function session(id: string, harness: SessionHarness, preconfigId: string | null, extra: Partial<Session> = {}): void {
  createSession({ id, workspaceId: 'ws', title: id, status: 'active', permissionMode: 'standard',
    preconfigId, agentId: preconfigId, metadata: null, parentId: null, agentName: null, harness, ...extra });
}
const agent = (id: string, overrides: Record<string, unknown>) => createPreconfig({
  id, name: id[0]!.toUpperCase() + id.slice(1), description: `${id} agent`, systemPrompt: '', tools: null, model: null, provider: null,
  variant: null, settings: null, isDefault: false, mode: 'primary', ...overrides,
});
const messagingTools = async (sessionId: string) =>
  (await manager.getWorkspaceTools(root, sessionId)).filter(tool => tool.serverName === MESSAGING_TOOLS_NAME);

beforeEach(async () => {
  setupTestDatabase();
  root = await mkdtemp(join(tmpdir(), 'messaging-tools-'));
  Paths.configure({ dataDir: join(root, 'global') });
  seedWorkspace({ id: 'ws', path: root });
  seedWorkspace({ id: 'marketing-home', path: join(root, 'marketing-home') });
  installAgentRuntimeTools(messagingRuntimeTools);
  manager = createMcpManager();
  deliveries = [];
  // Marketing has a home; nobody else does.
  installAgentMessagingHost({
    deliver: async (input) => { deliveries.push(input); },
    homeWorkspace: async (agentId) => agentId === 'marketing' ? { id: 'marketing-home', path: join(root, 'marketing-home') } : null,
    maxHops: () => 6,
    conversations: createMemoryAgentConversationStore(),
  });
  await agent('coding', {});
  await agent('marketing', { acceptsMessages: true });
  await agent('private', { acceptsMessages: false });
});
afterEach(async () => {
  installAgentRuntimeTools(null);
  installAgentMessagingHost(null);
  await manager.shutdownWorkspace(root); await manager.shutdownWorkspace(null);
  resetTestDatabase(); Paths.reset(); await rm(root, { recursive: true, force: true });
});

test('every harness lists message_agent when there is someone to write to; the description names them', async () => {
  session('claude', 'claude-cli', 'coding');
  session('codex', 'codex-cli', 'coding');
  session('prokop', 'prokop', 'coding');
  session('plain', 'prokop', null);
  for (const id of ['claude', 'codex', 'prokop', 'plain']) {
    const [tool] = await messagingTools(id);
    expect(tool?.name).toBe('message_agent');
    expect(tool!.description).toContain('- marketing (Marketing): marketing agent');
    expect(tool!.description).not.toContain('private');
  }
  // Marketing itself has nobody to write to; a closed sender sees nothing; a missing session sees nothing.
  session('marketing-session', 'prokop', 'marketing');
  expect(await messagingTools('marketing-session')).toEqual([]);
  await agent('mute', { canMessage: [] });
  session('mute-session', 'prokop', 'mute');
  expect(await messagingTools('mute-session')).toEqual([]);
  expect(await messagingTools('missing')).toEqual([]);
  // Not an MCP server: nothing to configure or toggle.
  expect(Object.keys(await manager.getAllServerStatus(null))).not.toContain(MESSAGING_TOOLS_NAME);
});

test('a call creates the conversation in the recipient home and delivers; refusals come back typed', async () => {
  session('prokop', 'prokop', 'coding');
  const [tool] = await messagingTools('prokop');
  const sent = await tool!.execute({ agent_id: 'marketing', message: 'Brand colors?', intent: 'question', clientRequestId: 'q1' });
  expect(sent.isError).toBe(false);
  const result = JSON.parse(String(sent.content[0]!.text)) as Record<string, unknown>;
  expect(result).toMatchObject({ delivered: true, intent: 'question', hop: 1 });
  const conversation = getSession(String(result.conversation_session_id));
  expect(conversation).toMatchObject({ workspaceId: 'marketing-home', agentId: 'marketing', preconfigId: 'marketing', parentId: null, title: 'From Coding: prokop' });
  expect(deliveries).toEqual([{ sessionId: conversation!.id, key: 'agent-message:prokop:q1', content: expect.stringContaining('<agent_message from="coding"') }]);

  const refused = await tool!.execute({ agent_id: 'private', message: 'Hi' });
  expect(refused.isError).toBe(true);
  expect(JSON.parse(String(refused.content[0]!.text))).toMatchObject({ delivered: false, code: 'not_accepting_messages' });
  expect((await tool!.execute({ agent_id: 'marketing', message: 'x' }, undefined, async () => false)).isError).toBe(true);
  expect(deliveries).toHaveLength(1);
});

test('Claude lists it on its workspace MCP server with the shared schema', async () => {
  session('claude', 'claude-cli', 'coding');
  const config = createClaudeWorkspaceMcp(await messagingTools('claude'), new AbortController().signal, async () => true)!;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await config.instance.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = (await client.listTools()).tools;
    expect(listed.map(tool => tool.name)).toEqual(['message_agent']);
    expect((listed[0]!.inputSchema as { required: string[] }).required).toEqual(['agent_id', 'message']);
  } finally { await client.close(); await config.instance.close(); }
});
