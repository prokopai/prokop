/**
 * Group chat tools are a built-in like delegation and messaging: the MCP
 * manager lists `group_history` and `handoff_to_agent` only to member
 * sessions, on every harness, with the other members in the description. A
 * handoff through the tool posts to the group and wakes the target through
 * the delivery primitive. The store is the real SQLite one; member sessions
 * stay out of every session list category.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMessage, Session, SessionHarness } from '@prokopai/sdk';
import { createAgentGroupsService, type AgentGroupsService } from '@prokopai/core/application/groups/service';
import { installAgentGroups } from '@prokopai/core/application/ports/agent-groups';
import { installAgentRuntimeTools } from '@prokopai/core/application/ports/runtime-tools';
import { createPreconfig } from '@prokopai/core/infrastructure/config/preconfig';
import { Paths } from '@prokopai/core/infrastructure/runtime/paths';
import { getPreconfigOrAgent } from '@prokopai/agent/internal/harnesses/prokop/context/sources';
import { GROUP_TOOLS_NAME, groupRuntimeTools } from '@prokopai/agent/internal/groups/tools';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createAgentGroupStore } from '@/infrastructure/sqlite/agent-groups';
import { createMessage, createPart, getMessageWithParts, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { countSessionsByWorkspace, createSession, deleteSession, getSession, listSessionPageByWorkspace, updateSession } from '@/infrastructure/sqlite/session-store';
import { createMcpManager } from '@/infrastructure/mcp/manager';

let root: string;
let manager: ReturnType<typeof createMcpManager>;
let service: AgentGroupsService;
let deliveries: Array<{ sessionId: string; content: string; key: string }>;
let broadcasts: ServerMessage[];

function session(id: string, harness: SessionHarness, preconfigId: string | null, extra: Partial<Session> = {}): void {
  createSession({ id, workspaceId: 'ws', title: id, status: 'active', permissionMode: 'standard',
    preconfigId, agentId: preconfigId, metadata: null, parentId: null, agentName: null, harness, ...extra });
}
const agent = (id: string, name: string, overrides: Record<string, unknown> = {}) => createPreconfig({
  id, name, description: `${name} agent`, systemPrompt: '', tools: null, model: null, provider: null,
  variant: null, settings: null, isDefault: false, mode: 'primary', ...overrides,
});
const groupTools = async (sessionId: string) =>
  (await manager.getWorkspaceTools(root, sessionId)).filter(tool => tool.serverName === GROUP_TOOLS_NAME);
const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

beforeEach(async () => {
  setupTestDatabase();
  root = await mkdtemp(join(tmpdir(), 'group-tools-'));
  Paths.configure({ dataDir: join(root, 'global') });
  seedWorkspace({ id: 'ws', path: root });
  installAgentRuntimeTools(groupRuntimeTools);
  manager = createMcpManager();
  deliveries = [];
  broadcasts = [];
  service = createAgentGroupsService({
    store: createAgentGroupStore(getDatabase),
    sessions: {
      getSession,
      createSession,
      deleteSession: (id) => { deleteSession(id); },
      setPermissionMode: (id, permissionMode) => { updateSession(id, { permissionMode }); },
      getMessageWithParts: async (_sessionId, messageId) => getMessageWithParts(messageId),
      listTranscript: async (sessionId) => listMessagesWithParts(sessionId),
    },
    getPreconfigOrAgent,
    deliver: async (input) => { deliveries.push(input); },
    pinModel: async () => {},
    maxHops: () => 6,
    interrupt: async () => {},
    broadcast: (message) => { broadcasts.push(message); },
  });
  installAgentGroups(service);
  await agent('implementer', 'Implementer');
  await agent('reviewer', 'Reviewer', { modelHarness: 'claude-cli', model: 'claude-sonnet-5-5' });
  await agent('outsider', 'Outsider');
});
afterEach(async () => {
  installAgentRuntimeTools(null);
  installAgentGroups(null);
  await manager.shutdownWorkspace(root); await manager.shutdownWorkspace(null);
  resetTestDatabase(); Paths.reset(); await rm(root, { recursive: true, force: true });
});

test('only member sessions list the group tools; the handoff description names the other members', async () => {
  session('plain', 'prokop', 'implementer');
  session('claude', 'claude-cli', 'reviewer');
  expect(await groupTools('plain')).toEqual([]);
  expect(await groupTools('claude')).toEqual([]);

  const group = unwrap(await service.create({ workspaceId: 'ws', name: 'API work', memberAgentIds: ['implementer', 'reviewer'] }));
  const reviewer = group.members.find(member => member.agentId === 'reviewer')!;
  expect(getSession(reviewer.sessionId)).toMatchObject({ harness: 'claude-cli', workspaceId: 'ws', metadata: { groupMember: { groupId: group.id, agentId: 'reviewer' } } });
  const tools = await groupTools(reviewer.sessionId);
  expect(tools.map(tool => tool.name)).toEqual(['group_history', 'handoff_to_agent']);
  expect(tools[1]!.description).toContain('- implementer (Implementer): Implementer agent');
  expect(tools[1]!.description).not.toContain('reviewer (Reviewer)');
  expect(tools[1]!.description).not.toContain('outsider');
  // Not an MCP server: nothing to configure or toggle.
  expect(Object.keys(await manager.getAllServerStatus(null))).not.toContain(GROUP_TOOLS_NAME);

  // Member sessions are in no list category, so nothing shows them but the group.
  expect(countSessionsByWorkspace('ws')).toEqual({ active: 2, archived: 0, scheduled: 0, conversations: 0 });
  const active = listSessionPageByWorkspace('ws', { limit: 50, category: 'active' } as never);
  expect(active.sessions.map((row: Session) => row.id).sort()).toEqual(['claude', 'plain']);
});

test('a handoff through the tool posts to the group and wakes the target with the catch-up; history reads the thread', async () => {
  const group = unwrap(await service.create({ workspaceId: 'ws', name: 'API work', memberAgentIds: ['implementer', 'reviewer'] }));
  const implementer = group.members.find(member => member.agentId === 'implementer')!;
  const reviewer = group.members.find(member => member.agentId === 'reviewer')!;
  unwrap(await service.postUserMessage(group.id, { text: '@Implementer add rate limiting' }));
  expect(deliveries).toHaveLength(1);
  // The wake is in the implementer's transcript, the way the delivery primitive puts it there.
  const wake = createMessage({ id: 'u1', sessionId: implementer.sessionId, role: 'user', createdAt: Date.now() });
  createPart({ id: 'u1-t', messageId: wake.id, createdAt: Date.now(), type: 'text', text: deliveries[0]!.content }, implementer.sessionId);

  const [history, handoff] = await groupTools(implementer.sessionId);
  const read = JSON.parse(String((await history!.execute({ limit: 10 })).content[0]!.text)) as { ok: boolean; messages: Array<{ author: string; text: string }> };
  expect(read.ok).toBe(true);
  expect(read.messages).toEqual([expect.objectContaining({ author: '[User]', text: '@Implementer add rate limiting' })]);

  const handed = await handoff!.execute({ agent_id: 'reviewer', message: 'Token bucket is in middleware.ts; review it.' });
  expect(handed.isError).toBe(false);
  expect(JSON.parse(String(handed.content[0]!.text))).toMatchObject({ ok: true, target: 'reviewer', hop: 1, seq: 2 });
  expect(deliveries).toHaveLength(2);
  expect(deliveries[1]).toMatchObject({ sessionId: reviewer.sessionId, key: `group-wake:${group.id}:reviewer:2` });
  expect(deliveries[1]!.content).toContain('[Implementer → Reviewer, handoff] Token bucket is in middleware.ts; review it.');
  expect(deliveries[1]!.content).toContain('hop="1"');
  expect(broadcasts.filter(message => message.type === 'group.message.created')).toHaveLength(2);

  const refused = await handoff!.execute({ agent_id: 'outsider', message: 'x' });
  expect(refused.isError).toBe(true);
  expect(JSON.parse(String(refused.content[0]!.text))).toMatchObject({ ok: false, code: 'not_member' });
  expect((await handoff!.execute({ agent_id: 'reviewer', message: 'x' }, undefined, async () => false)).isError).toBe(true);
  expect(deliveries).toHaveLength(2);

  // Deleting the group takes the member sessions and the thread with it.
  unwrap(await service.remove(group.id));
  expect(getSession(implementer.sessionId)).toBeNull();
  expect(getDatabase().query('SELECT COUNT(*) AS count FROM agent_group_messages').get()).toEqual({ count: 0 });
  expect(getDatabase().query('SELECT COUNT(*) AS count FROM agent_group_members').get()).toEqual({ count: 0 });
  expect(await groupTools(implementer.sessionId)).toEqual([]);
});
