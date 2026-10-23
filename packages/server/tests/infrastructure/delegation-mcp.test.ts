/**
 * Delegation is one tool set on every harness: the MCP manager appends the
 * four tools to the workspace tool list for any active session whose agent
 * may spawn subagents (Prokop, Claude Code, Codex, a subagent-mode role
 * included), without an MCP settings entry; a call runs the shared service
 * with its typed refusals; Claude lists them with the shared schema. A
 * target the agent may not pick alone asks the user through the one
 * built-in ask path on every harness, with "Allow for this agent".
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AskRequestMessage, ServerMessage, Session, SessionHarness } from '@prokopai/sdk';
import { installAgentAskPort } from '@prokopai/core/application/ports/agent-asks';
import { configureHarnessProbes } from '@prokopai/core/application/ports/harness-probes';
import { installDelegationHost } from '@prokopai/core/application/ports/delegation-host';
import { installHeadlessExecutionPort } from '@prokopai/core/application/ports/headless-execution';
import { installAgentRuntimeTools } from '@prokopai/core/application/ports/runtime-tools';
import { clearModelsCache } from '@prokopai/core/config';
import { createPreconfig, getPreconfig } from '@prokopai/core/infrastructure/config/preconfig';
import { configureHarnessAsks } from '@prokopai/core/infrastructure/runtime/harness-asks';
import { Paths } from '@prokopai/core/infrastructure/runtime/paths';
import { directAgentAsks } from '@prokopai/agent/internal/composition/asks';
import { DELEGATION_TOOLS_NAME, delegationRuntimeTools } from '@prokopai/agent/internal/composition/runtime-tools';
import { DELEGATION_TOOL_NAMES } from '@prokopai/agent/internal/harnesses/prokop/subagent/tools';
import { createClaudeWorkspaceMcp } from '@prokopai/agent/internal/harnesses/claude-cli/mcp-tools';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { localHarnessAsks } from '@/bootstrap/harness-asks';
import { getPermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createMcpManager } from '@/infrastructure/mcp/manager';
import { installDeliveryPort } from '@/transport/websocket/broadcast';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { handleClientRegistration, registerConnection, unregisterConnection } from '@/transport/websocket/connection-registry';
import { handleClaim, removeSessionControl } from '@/transport/websocket/control-registry';
import { handleAskResponse } from '@/transport/websocket/handlers/misc';
import type { RouterContext } from '@/transport/websocket/router-context';

let root: string;
let manager: ReturnType<typeof createMcpManager>;
let sockets: object[];
let claimed: string[];
let requests: AskRequestMessage[];

function session(id: string, harness: SessionHarness, preconfigId: string | null = null, permissionMode: Session['permissionMode'] = 'standard'): void {
  createSession({ id, workspaceId: 'ws', title: id, status: 'active', permissionMode,
    preconfigId, metadata: null, parentId: null, agentName: null, harness });
}
/** A web client that controls `sessionId`, the one who may answer its asks. */
function controller(sessionId: string): ConnectionId {
  const socket = {}; sockets.push(socket);
  const connection = registerConnection(socket);
  handleClientRegistration(connection, { type: 'client.register', client: { clientId: `controller-${sessionId}`, clientType: 'web',
    displayName: 'controller', interactionMode: 'human', capabilities: [] } }, () => {});
  handleClaim(sessionId, connection);
  claimed.push(sessionId);
  return connection;
}
async function request(index: number): Promise<AskRequestMessage> {
  for (let attempt = 0; attempt < 200 && !requests[index]; attempt++) await Bun.sleep(2);
  expect(requests[index]).toBeDefined();
  return requests[index]!;
}
const silentDelivery = { sendToConnection: () => {}, sendToAskTargets: () => {}, broadcast: () => {}, broadcastToSession: () => {}, sendToController: () => {} };
const ctx = { send: () => {} } as unknown as RouterContext<ConnectionId>;
/** The controller answers the ask the way the client does: a grant scope, or the grant 'deny'. */
const answer = (from: ConnectionId, ask: AskRequestMessage, grant: 'once' | 'workspace' | 'deny') =>
  handleAskResponse(ctx, from, { type: 'ask.response', toolCallId: ask.toolCallId, requestId: ask.requestId, response: { type: 'permission', grant } });
const delegate = async (sessionId: string, input: Record<string, unknown>, signal?: AbortSignal) => {
  const tool = (await delegationTools(sessionId)).find(tool => tool.name === 'delegate_task')!;
  const result = await tool.execute({ description: 'Review', prompt: 'Review it', subagent_type: 'explore', mode: 'wait', ...input }, signal);
  return JSON.parse(String(result.content[0]!.text)) as Record<string, unknown>;
};
const overrideToCodex = { target: { harness: 'codex-cli' } };
const delegationTools = async (sessionId: string) =>
  (await manager.getWorkspaceTools(root, sessionId)).filter(tool => tool.serverName === DELEGATION_TOOLS_NAME);
const role = (id: string, overrides: Record<string, unknown>) => createPreconfig({
  id, name: id, description: '', systemPrompt: '', tools: null, model: null, provider: null, variant: null,
  settings: null, isDefault: false, mode: 'primary', ...overrides,
});

beforeEach(async () => {
  setupTestDatabase();
  root = await mkdtemp(join(tmpdir(), 'delegation-tools-'));
  Paths.configure({ dataDir: join(root, 'global') });
  // delegation_capabilities reports the caller's model from the catalog.
  await mkdir(join(root, 'global'), { recursive: true });
  await writeFile(join(root, 'global', 'models.json'), JSON.stringify({
    providers: [{ id: 'test', name: 'Test', models: [{ id: 'test-model', name: 'Test model', contextWindow: 1000 }] }],
    defaultModel: 'test-model', defaultProvider: 'test',
  }));
  clearModelsCache();
  seedWorkspace({ id: 'ws', path: root });
  installAgentRuntimeTools(delegationRuntimeTools);
  manager = createMcpManager();
  session('claude', 'claude-cli');
  session('codex', 'codex-cli');
  session('prokop', 'prokop');
  // No host dispatch and the permissive memory host: an approved delegation is refused at dispatch, never run.
  // (A test that wired the full application earlier in the process leaves its ports installed.)
  installHeadlessExecutionPort(null);
  installDelegationHost(null);
  // The ask path: rows and control state from the server, answers through the agent ask port.
  sockets = []; claimed = []; requests = [];
  configureHarnessAsks(localHarnessAsks);
  installAgentAskPort(directAgentAsks);
  installDeliveryPort({ ...silentDelivery, sendToAskTargets: (_id, _authority, message: ServerMessage) => {
    if (message.type === 'ask.request') requests.push(message);
  } });
});
afterEach(async () => {
  installAgentRuntimeTools(null);
  for (const sessionId of claimed) removeSessionControl(sessionId);
  for (const socket of sockets) unregisterConnection(socket);
  installDeliveryPort(silentDelivery);
  await manager.shutdownWorkspace(root); await manager.shutdownWorkspace(null);
  resetTestDatabase(); Paths.reset(); clearModelsCache(); await rm(root, { recursive: true, force: true });
});

test('every harness gets the four tools; only the agent setting hides them', async () => {
  for (const id of ['claude', 'codex', 'prokop']) {
    expect((await delegationTools(id)).map(tool => tool.name)).toEqual([...DELEGATION_TOOL_NAMES]);
  }
  expect(await delegationTools('missing')).toEqual([]);

  await role('solo', { canSpawnSubagents: false });
  session('solo-session', 'prokop', 'solo');
  expect(await delegationTools('solo-session')).toEqual([]);

  // A subagent-mode role may delegate when its own setting says so.
  await role('worker', { mode: 'subagent', canSpawnSubagents: true });
  session('worker-session', 'prokop', 'worker');
  expect((await delegationTools('worker-session')).map(tool => tool.name)).toEqual([...DELEGATION_TOOL_NAMES]);

  // Not an MCP server: nothing to configure or toggle.
  expect(Object.keys(await manager.getAllServerStatus(null))).not.toContain(DELEGATION_TOOLS_NAME);
  installAgentRuntimeTools(null);
  expect(await delegationTools('prokop')).toEqual([]);
});

test('the shared definitions require a role, default to async, and spell out the efforts each CLI offers', async () => {
  // No catalog at hand: the schema points at delegation_capabilities for efforts.
  configureHarnessProbes({ models: async () => { throw new Error('no CLI here'); }, usageLimits: async harness => ({ harness, checkedAt: '', plan: null, windows: [] }), nativeTitle: async () => null });
  const [plain] = await delegationRuntimeTools.definitions('prokop');
  const plainTarget = (plain!.inputSchema as { properties: { target: { properties: { variant: { description: string } } } } }).properties.target.properties;
  expect(plainTarget.variant.description).toContain('one of the efforts delegation_capabilities lists');

  // With the CLI catalogs at hand, the ladder is in the schema itself.
  configureHarnessProbes({
    models: async harness => harness === 'codex-cli'
      ? [{ model: 'gpt-5.5', name: 'GPT-5.5', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
        { model: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', supportedEfforts: ['medium', 'high', 'max'], defaultEffort: 'high', isDefault: false }]
      : [{ model: 'claude-sonnet-5', name: 'Sonnet 5', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }],
    usageLimits: async harness => ({ harness, checkedAt: '', plan: null, windows: [] }),
    nativeTitle: async () => null,
  });
  const [delegate] = await delegationRuntimeTools.definitions('prokop');
  const target = (delegate!.inputSchema as { properties: { target: { properties: { variant: { description: string }; model: { description: string } } } } }).properties.target.properties;
  expect(target.variant.description).toContain('codex-cli: low, medium, high, max; claude-cli: low, medium, high');
  expect(target.model.description).toContain('delegation_capabilities');
  const schema = delegate!.inputSchema as { properties: Record<string, { description?: string }>; required: string[] };
  expect(schema.required).toEqual(['description', 'prompt', 'subagent_type']);
  expect(schema.properties.mode!.description).toStartWith('async (default)');
  expect(schema.properties.target).toBeDefined();
  expect(schema.properties.isolation).toBeDefined();
});

test('a call runs the delegation service and reports its typed refusal; a withdrawn session gets nothing', async () => {
  const tools = await delegationTools('prokop');
  const delegate = tools.find(tool => tool.name === 'delegate_task')!;
  const refused = await delegate.execute({ description: 'Review', prompt: 'Review it' });
  expect(refused.isError).toBe(true);
  expect(JSON.parse(String(refused.content[0]!.text))).toMatchObject({ code: 'invalid_request' });

  const capabilities = tools.find(tool => tool.name === 'delegation_capabilities')!;
  const listed = await capabilities.execute({});
  expect(listed.isError).toBe(false);
  expect(JSON.parse(String(listed.content[0]!.text))).toMatchObject({ roles: [], caller: { harness: 'prokop' } });

  expect((await delegate.execute({ description: 'Review', prompt: 'x' }, undefined, async () => false)).isError).toBe(true);
  expect((await delegate.execute({ description: 'x'.repeat(70_000), prompt: 'x' })).isError).toBe(true);
});

test('Claude lists them on its workspace MCP server with the shared schema', async () => {
  const config = createClaudeWorkspaceMcp(await delegationTools('claude'), new AbortController().signal, async () => true)!;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await config.instance.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = (await client.listTools()).tools;
    expect(listed.map(tool => tool.name)).toEqual([...DELEGATION_TOOL_NAMES]);
    expect((listed[0]!.inputSchema as { required: string[] }).required).toEqual(['description', 'prompt', 'subagent_type']);
  } finally { await client.close(); await config.instance.close(); }
});

test('a target the agent may not pick alone asks the user on a Prokop and a Claude session; the client\'s deny refuses it', async () => {
  await role('explore', { mode: 'subagent' });
  await role('parent', { delegationTargets: ['prokop'] });
  for (const [index, harness] of (['prokop', 'claude-cli'] as const).entries()) {
    const sessionId = `${harness}-parent`;
    session(sessionId, harness, 'parent');
    const web = controller(sessionId);

    const pending = delegate(sessionId, overrideToCodex);
    const ask = await request(index);
    expect(ask).toMatchObject({ sessionId, toolName: 'delegate_task', ask: { type: 'permission', action: 'delegate', allowedScopes: ['once', 'workspace'] } });
    expect(ask.toolCallId).toStartWith('builtin-ask:');
    expect((ask.ask as { question: string }).question).toContain('Codex');
    expect(getPermissionRequestByRequestId(ask.requestId!)).toMatchObject({ sessionId, status: 'pending', toolName: 'delegate_task' });

    await answer(web, ask, 'deny');
    expect(await pending).toMatchObject({ task_id: '', code: 'target_not_allowed' });
    expect(getPermissionRequestByRequestId(ask.requestId!)?.status).toBe('denied');
    expect((await getPreconfig('parent'))?.delegationTargets).toEqual(['prokop']);
  }
});

test('"Allow for this agent" writes the harness into the agent\'s delegation targets, on a Prokop and a Claude session', async () => {
  await role('explore', { mode: 'subagent' });
  for (const [index, harness] of (['prokop', 'claude-cli'] as const).entries()) {
    const sessionId = `${harness}-parent`;
    const preconfigId = `${harness}-agent`;
    await role(preconfigId, { delegationTargets: ['prokop'] });
    session(sessionId, harness, preconfigId);
    const web = controller(sessionId);

    const pending = delegate(sessionId, overrideToCodex);
    const ask = await request(index);
    await answer(web, ask, 'workspace');
    // Approved: the call goes on to run (no harness dispatch in this test), the refusal is gone.
    expect((await pending).code).not.toBe('target_not_allowed');
    expect(getPermissionRequestByRequestId(ask.requestId!)?.status).toBe('approved');
    expect((await getPreconfig(preconfigId))?.delegationTargets).toEqual(['prokop', 'codex-cli']);

    // Remembered: the same override no longer asks.
    expect((await delegate(sessionId, overrideToCodex)).code).not.toBe('target_not_allowed');
    expect(requests).toHaveLength(index + 1);
  }
});

test('nobody to ask refuses the override; extended mode approves it on its own; an abort while asking declines', async () => {
  await role('explore', { mode: 'subagent' });
  await role('parent', { delegationTargets: ['prokop'] });

  session('lonely', 'prokop', 'parent');
  expect(await delegate('lonely', overrideToCodex)).toMatchObject({ task_id: '', code: 'target_not_allowed' });
  expect(requests).toEqual([]);

  session('trusting', 'claude-cli', 'parent', 'extended');
  expect((await delegate('trusting', overrideToCodex)).code).not.toBe('target_not_allowed');
  expect(requests).toEqual([]);

  session('stopped', 'prokop', 'parent');
  controller('stopped');
  const abort = new AbortController();
  const pending = delegate('stopped', overrideToCodex, abort.signal);
  const ask = await request(0);
  abort.abort();
  expect(await pending).toMatchObject({ task_id: '', code: 'target_not_allowed' });
  expect(getPermissionRequestByRequestId(ask.requestId!)?.status).toBe('expired');
});
