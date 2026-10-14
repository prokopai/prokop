/**
 * Host/agent split, Phase 1b: a full Prokop turn whose storage crosses the
 * agent protocol (in-process loopback, JSON on the wire) must leave the same
 * transcript in the host store as a turn that calls the store directly.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Audience } from '@prokopai/agent-protocol';
import type { LoadedTool } from '@prokopai/sdk/tool';
import type { ServerMessage } from '@prokopai/sdk/types';
import { createProtocolRuntimeHost } from '@/agent-bridge/agent-runtime-host';
import { createRuntimeHostHandlers } from '@/agent-bridge/host-runtime';
import { createAgentLoopback, createLoopbackStorage } from '@/agent-bridge/loopback';
import { audienceOf, mapCapekEventToServerMessage } from '@/harnesses/prokop/host/events';
import type { RuntimeDelivery } from '@/infrastructure/runtime/events';
import type { RuntimeHost } from '@/infrastructure/runtime/host';
import type { StorageBundle } from '@/infrastructure/storage/contracts';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import { StandaloneAgent } from '#tests/engine/helpers/standalone-agent';

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function grepTool(): LoadedTool {
  return {
    definition: {
      name: 'grep',
      description: 'Local test grep.',
      inputSchema: {
        type: 'object',
        properties: { pattern: { type: 'string' }, path: { type: 'string' } },
        required: ['pattern', 'path'],
      },
      timeout: 5000,
    },
    execute: async (input) => ({ success: true, result: { content: `a.txt:${String(input.pattern)} marks the spot`, truncated: false } }),
    path: 'builtin:test',
  };
}

const TIME_KEYS = new Set(['createdAt', 'updatedAt', 'startedAt', 'completedAt', 'endedAt', 'runningAt', 'time', 'durationMs']);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, TIME_KEYS.has(key) && item !== null ? '<time>' : normalize(item)]));
  }
  return typeof value === 'string' ? value.replace(UUID, '<uuid>') : value;
}

async function runTurn(root: string, mode: 'direct' | 'loopback') {
  const host = createInMemoryStorageBundle();
  let storage: StorageBundle = host;
  if (mode === 'loopback') {
    const loopback = createLoopbackStorage(host);
    storage = loopback.storage;
    cleanup.push(loopback.close);
  }
  const agent = new StandaloneAgent({
    model: 'openai/gpt-4o-mini',
    workspace: root,
    tools: [grepTool()],
    storage,
    sandbox: {
      rules: [
        { match: { mode: 'stream', hasToolResults: false },
          response: { type: 'tool-call', toolName: 'grep', args: { pattern: 'x', path: root } }, maxUses: 1 },
        { match: { mode: 'stream', hasToolResults: true },
          response: { type: 'text', content: 'Found it in a.txt.' }, maxUses: 1 },
      ],
    },
  });
  cleanup.push(() => agent.close());
  const result = await agent.run('where is x?');
  const transcript = await host.conversation.listMessagesWithParts(result.sessionId);
  return { result, transcript };
}

function askingGrepTool(): LoadedTool {
  return {
    definition: {
      name: 'grep',
      description: 'Local test grep.',
      inputSchema: {
        type: 'object',
        properties: { pattern: { type: 'string' }, path: { type: 'string' } },
        required: ['pattern', 'path'],
      },
      timeout: 5000,
    },
    execute: async (input, context) => {
      const approved = await context.ask({
        type: 'permission', question: `Allow grep on ${String(input.path)}?`, risk: 'medium',
        resource: 'file', action: 'read', paths: [String(input.path)],
      });
      return approved
        ? { success: true, result: { content: 'a.txt:x marks the spot', truncated: false } }
        : { success: false, error: 'USER_REJECTION' };
    },
    path: 'builtin:test',
  };
}

type Delivered = Array<[string, unknown]>;

/** The wire form of a runtime delivery, exactly as the bootstrap maps it. */
function toWire(delivery: RuntimeDelivery): { audience: Audience; message: ServerMessage } | null {
  const message = mapCapekEventToServerMessage(delivery.event);
  const audience = audienceOf(delivery);
  if (!message || audience.scope === 'host' || audience.scope === 'origin') return null;
  return { audience: audience as Audience, message };
}

/** Direct path: the base host, recording what its delivery would broadcast. */
function recordingHost(base: RuntimeHost, delivered: Delivered): RuntimeHost {
  return {
    ...base,
    delivery: {
      emit(delivery) {
        if (delivery.event.kind === 'terminal') {
          delivered.push(['turn.finished', delivery.event.message]);
          return;
        }
        const wire = toWire(delivery);
        if (wire) delivered.push([wire.audience.scope, wire.message]);
      },
    },
  };
}

/** Protocol path: the base host serves the host side; the engine gets the protocol-backed host. */
function protocolHost(base: RuntimeHost, delivered: Delivered): RuntimeHost {
  const runtime = createRuntimeHostHandlers({
    interaction: base.interaction,
    resolveSessionWorkspace: base.workspace.resolveSessionWorkspace
      ?? (async options => ({ workspacePath: options.workspacePath, additionalPaths: options.additionalPaths })),
    addWorkspaceRoot: () => false,
    removeWorkspaceRoot: () => false,
    router: {
      broadcast: message => delivered.push(['global', message]),
      broadcastToSession: (_sessionId, message) => delivered.push(['session', message]),
      sendToController: (_sessionId, message) => delivered.push(['controller', message]),
      sendToAskTargets: (_sessionId, _authority, message) => delivered.push(['ask_targets', message]),
    },
    notifyTurnFinished: message => delivered.push(['turn.finished', message]),
  });
  const { agent, close } = createAgentLoopback({ handlers: runtime.handlers, notifications: runtime.notifications });
  cleanup.push(close);
  return createProtocolRuntimeHost(agent, {
    titles: base.titles,
    toolPolicy: base.toolPolicy,
    layout: base.layout,
    guidance: base.guidance,
    isSandboxActive: () => base.sandbox.isSandboxActive(),
    getPermissionTimeoutMs: () => base.interaction.getPermissionTimeoutMs(),
    autoApproveSeverity: base.interaction.getSessionAutoApproveSeverity,
    createToolWorkspaceHost: options => base.workspace.createToolWorkspaceHost(options),
    toWire,
  });
}

async function runAskingTurn(root: string, mode: 'direct' | 'loopback') {
  const hostStorage = createInMemoryStorageBundle();
  const delivered: Delivered = [];
  const asks: string[] = [];
  let storage: StorageBundle = hostStorage;
  if (mode === 'loopback') {
    const loopback = createLoopbackStorage(hostStorage);
    storage = loopback.storage;
    cleanup.push(loopback.close);
  }
  const agent = new StandaloneAgent({
    model: 'openai/gpt-4o-mini',
    workspace: root,
    tools: [askingGrepTool()],
    storage,
    host: base => (mode === 'loopback' ? protocolHost(base, delivered) : recordingHost(base, delivered)),
    interaction: (request) => {
      asks.push(request.ask.type);
      return true;
    },
    sandbox: {
      rules: [
        { match: { mode: 'stream', hasToolResults: false },
          response: { type: 'tool-call', toolName: 'grep', args: { pattern: 'x', path: root } }, maxUses: 1 },
        { match: { mode: 'stream', hasToolResults: true },
          response: { type: 'text', content: 'Approved and found it.' }, maxUses: 1 },
      ],
    },
  });
  cleanup.push(() => agent.close());
  const result = await agent.run('where is x?');
  const transcript = await hostStorage.conversation.listMessagesWithParts(result.sessionId);
  return { result, transcript, delivered, asks };
}

describe('Prokop turn over the agent protocol loopback', () => {
  test('an approved permission ask crosses the runtime-host protocol like the direct host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-loopback-ask-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));

    const direct = await runAskingTurn(root, 'direct');
    const viaProtocol = await runAskingTurn(root, 'loopback');

    expect(direct.result.status).toBe('completed');
    expect(direct.result.text).toBe('Approved and found it.');
    expect(direct.asks).toEqual(['permission']);
    const tool = direct.transcript.flatMap(entry => entry.parts).find(part => part.type === 'tool');
    expect(tool?.type === 'tool' && tool.state.status === 'completed' ? tool.state.output : null)
      .toEqual({ content: 'a.txt:x marks the spot', truncated: false });

    expect(direct.delivered.some(([scope, message]) =>
      scope === 'global' && (message as ServerMessage).type === 'session.updated')).toBe(true);

    expect(viaProtocol.result.status).toBe(direct.result.status);
    expect(viaProtocol.result.text).toBe(direct.result.text);
    expect(viaProtocol.asks).toEqual(direct.asks);
    expect(normalize(viaProtocol.transcript)).toEqual(normalize(direct.transcript));
    expect(normalize(viaProtocol.delivered)).toEqual(normalize(direct.delivered));
  });

  test('leaves the same transcript in the host store as a direct turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-loopback-turn-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, 'a.txt'), 'x marks the spot\n');

    const direct = await runTurn(root, 'direct');
    const viaProtocol = await runTurn(root, 'loopback');

    expect(direct.result.status).toBe('completed');
    expect(direct.result.text).toBe('Found it in a.txt.');
    const tool = direct.transcript.flatMap(entry => entry.parts).find(part => part.type === 'tool');
    expect(tool?.type === 'tool' ? tool.state.status : null).toBe('completed');

    expect(viaProtocol.result.status).toBe(direct.result.status);
    expect(viaProtocol.result.text).toBe(direct.result.text);
    expect(normalize(viaProtocol.transcript)).toEqual(normalize(direct.transcript));
  });
});
