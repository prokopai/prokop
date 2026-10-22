/**
 * The delegation tools as CLI parents see them: the shared definitions, the
 * Claude MCP wrappers (schema pinned to the live definition, authorization
 * tied to the turn's session) and the Codex dynamic-tool wrappers (per-call
 * authorization, duplicate call refusal, dispatch by tool name).
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { z } from 'zod';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { DELEGATION_TOOL_NAMES, type DelegationDomainBridge } from '@prokopai/agent/internal/harnesses/shared/domain-tools';
import { cliDelegationDefinitions } from '@prokopai/agent/internal/harnesses/shared/delegation/cli-delegation';
import { claudeDelegateShape, createClaudeDelegationTools } from '@prokopai/agent/internal/harnesses/claude-cli/delegation-tools';
import { createCodexDelegationTools } from '@prokopai/agent/internal/harnesses/codex-cli/delegation-tools';
import { DELEGATION_GUIDANCE } from '@prokopai/agent/internal/harnesses/shared/cli-instructions';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, updateSession } from '@/infrastructure/sqlite/session-store';

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

const boilerplate = new Set(['~standard', '$schema', 'additionalProperties']);
const clean = (value: unknown): unknown => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !boilerplate.has(key)).map(([key, item]) => [key, clean(item)]))
  : value;

function fakeBridge() {
  const calls: Array<{ tool: string; input: Record<string, unknown>; context: { sessionId: string; workspaceId: string; workspacePath: string } }> = [];
  const bridge: DelegationDomainBridge = {
    definitions: cliDelegationDefinitions,
    delegate: async (input, context) => { calls.push({ tool: 'delegate_task', input, context }); return { task_id: 't1', status: 'running', result: 'task_id: t1 is running' }; },
    capabilities: async (input, context) => { calls.push({ tool: 'delegation_capabilities', input, context }); return { roles: [], harnesses: [] }; },
    status: async (input, context) => { calls.push({ tool: 'task_status', input, context }); return { task_id: String(input.task_id), status: 'completed', result: 'done' }; },
    cancel: async (input, context) => { calls.push({ tool: 'task_cancel', input, context }); return { task_id: String(input.task_id), status: 'cancelled' }; },
  };
  return { bridge, calls };
}

beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: '/repo' });
});
afterEach(() => resetTestDatabase());

test('the shared definitions carry the four tools with delegate_task defaulting CLI parents to async', () => {
  const definitions = cliDelegationDefinitions();
  expect(definitions.map((definition) => definition.name)).toEqual([...DELEGATION_TOOL_NAMES]);
  const delegate = definitions[0]!.inputSchema as { properties: Record<string, { description?: string }>; required: string[] };
  expect(delegate.required).toEqual(['description', 'prompt']);
  expect(delegate.properties.mode!.description).toStartWith('async (default)');
  expect(delegate.properties.target).toBeDefined();
  expect(definitions[0]!.description).toContain('native subagents for same-harness');
  expect(DELEGATION_GUIDANCE).toContain('do not poll');
});

test('the Claude delegate_task shape matches the live definition', () => {
  const definition = cliDelegationDefinitions()[0]!.inputSchema as { properties: Record<string, unknown> };
  const live = clean(z.toJSONSchema(z.object(claudeDelegateShape))) as { properties: Record<string, unknown> };
  expect(Object.keys(live.properties).sort()).toEqual(Object.keys(definition.properties).sort());
});

test('Claude tools run only for the owning active Claude session and relay the bridge result', async () => {
  createSession({ id: 's', workspaceId: 'ws', title: 'Claude', status: 'active',
    preconfigId: 'agent', metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
  const { bridge, calls } = fakeBridge();
  const controller = new AbortController();
  const tools = createClaudeDelegationTools({ bridge, sessionId: 's', workspaceId: 'ws', root: '/repo', preconfigId: 'agent', signal: controller.signal });
  expect(tools.map((tool) => tool.name)).toEqual([...DELEGATION_TOOL_NAMES]);

  const delegated = await tools[0]!.handler({ description: 'Review', prompt: 'Review it', target: { harness: 'codex-cli' } }, {}) as ToolResult;
  expect(delegated.isError).toBe(false);
  expect(JSON.parse((delegated.content[0] as { text: string }).text)).toMatchObject({ task_id: 't1', status: 'running' });
  expect(calls[0]).toMatchObject({ tool: 'delegate_task', context: { sessionId: 's', workspaceId: 'ws', workspacePath: '/repo' } });

  const status = await tools[2]!.handler({ task_id: 't1' }, {}) as ToolResult;
  expect(JSON.parse((status.content[0] as { text: string }).text)).toMatchObject({ status: 'completed', result: 'done' });

  // Another preconfig took over the session: the registered tools go dark.
  updateSession('s', { preconfigId: 'other' });
  const refused = await tools[1]!.handler({}, {}) as ToolResult;
  expect(refused.isError).toBe(true);
  updateSession('s', { preconfigId: 'agent' });
  controller.abort();
  expect(((await tools[3]!.handler({ task_id: 't1' }, {})) as ToolResult).isError).toBe(true);
  expect(calls).toHaveLength(2);
});

test('Codex tools authorize per call, refuse duplicates and dispatch by name', async () => {
  createSession({ id: 's', workspaceId: 'ws', title: 'Codex', status: 'active',
    preconfigId: 'agent', metadata: null, parentId: null, agentName: null, harness: 'codex-cli' });
  const { bridge, calls } = fakeBridge();
  let active = true;
  let validRoot = true;
  const tools = createCodexDelegationTools({ bridge, sessionId: 's', workspaceId: 'ws', root: '/repo', preconfigId: 'agent',
    isActive: (turn) => active && turn === 'turn', authorizeRoot: async () => validRoot });
  expect(tools.definitions.map((definition) => definition.name)).toEqual([...DELEGATION_TOOL_NAMES]);
  const call = (tool: string, callId: string, args: unknown, turnId = 'turn') =>
    ({ threadId: 'thread', turnId, callId, namespace: null, tool, arguments: args });

  const delegated = await tools.call(call('delegate_task', 'c1', { description: 'Review', prompt: 'x' }));
  expect(delegated.success).toBe(true);
  expect(JSON.parse(delegated.contentItems[0]!.text)).toMatchObject({ task_id: 't1' });
  expect((await tools.call(call('delegate_task', 'c1', { description: 'Review', prompt: 'x' }))).success).toBe(false);
  expect((await tools.call(call('task_cancel', 'c2', { task_id: 't1' }))).success).toBe(true);
  expect(calls.map((entry) => entry.tool)).toEqual(['delegate_task', 'task_cancel']);

  expect((await tools.call(call('memory', 'c3', {}))).success).toBe(false);
  active = false;
  expect((await tools.call(call('task_status', 'c4', { task_id: 't1' }))).success).toBe(false);
  active = true;
  validRoot = false;
  expect((await tools.call(call('task_status', 'c5', { task_id: 't1' }))).success).toBe(false);
  expect(calls).toHaveLength(2);
});
