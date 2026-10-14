/**
 * Host/agent split, Phase 1b: a full Prokop turn whose storage crosses the
 * agent protocol (in-process loopback, JSON on the wire) must leave the same
 * transcript in the host store as a turn that calls the store directly.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LoadedTool } from '@prokopai/sdk/tool';
import { createLoopbackStorage } from '@/agent-bridge/loopback';
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

const TIME_KEYS = new Set(['createdAt', 'updatedAt', 'startedAt', 'completedAt', 'endedAt', 'time', 'durationMs']);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, TIME_KEYS.has(key) && typeof item === 'number' ? '<time>' : normalize(item)]));
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

describe('Prokop turn over the agent protocol loopback', () => {
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
