/**
 * Host/agent split: per-turn cost of storage over the agent protocol.
 * Runs the sandboxed Prokop turn from `agent-loopback-turn.test.ts` (one
 * tool call, one reply; no network) directly and over the loopback, and
 * reports wall time and host storage calls per turn.
 *
 *   bun tests/engine/agent-loopback-latency.bench.ts [turns]
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LoadedTool } from '@prokopai/sdk/tool';
import { createLoopbackStorage } from '@/agent-bridge/loopback';
import type { StorageBundle } from '@/infrastructure/storage/contracts';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import { StandaloneAgent } from '#tests/engine/helpers/standalone-agent';

const grep: LoadedTool = {
  definition: {
    name: 'grep',
    description: 'Local test grep.',
    inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern', 'path'] },
    timeout: 5000,
  },
  execute: async input => ({ success: true, result: { content: `a.txt:${String(input.pattern)} marks the spot`, truncated: false } }),
  path: 'builtin:test',
};

/** Counts every call the host bundle serves, one level into each store. */
function counted(bundle: StorageBundle, calls: { count: number }): StorageBundle {
  const wrap = <T extends object>(store: T): T => new Proxy(store, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.count++;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return Object.fromEntries(Object.entries(bundle).map(([key, store]) =>
    [key, store && typeof store === 'object' ? wrap(store) : store])) as unknown as StorageBundle;
}

async function turn(root: string, mode: 'direct' | 'loopback'): Promise<{ ms: number; calls: number }> {
  const calls = { count: 0 };
  const host = counted(createInMemoryStorageBundle(), calls);
  const loopback = mode === 'loopback' ? createLoopbackStorage(host) : undefined;
  const agent = new StandaloneAgent({
    model: 'openai/gpt-4o-mini',
    workspace: root,
    tools: [grep],
    storage: loopback?.storage ?? host,
    sandbox: {
      rules: [
        { match: { mode: 'stream', hasToolResults: false },
          response: { type: 'tool-call', toolName: 'grep', args: { pattern: 'x', path: root } }, maxUses: 1 },
        { match: { mode: 'stream', hasToolResults: true },
          response: { type: 'text', content: 'Found it in a.txt.' }, maxUses: 1 },
      ],
    },
  });
  const started = performance.now();
  const result = await agent.run('where is x?');
  const ms = performance.now() - started;
  await agent.close();
  loopback?.close();
  if (result.status !== 'completed') throw new Error(`turn ${mode} ended ${result.status}`);
  return { ms, calls: calls.count };
}

const turns = Number(process.argv[2] ?? 30);
const root = await mkdtemp(join(tmpdir(), 'agent-loopback-bench-'));
await writeFile(join(root, 'a.txt'), 'x marks the spot\n');
try {
  // Warm module caches and JIT for both paths.
  await turn(root, 'direct');
  await turn(root, 'loopback');
  const samples = { direct: [] as number[], loopback: [] as number[] };
  const calls = { direct: 0, loopback: 0 };
  for (let index = 0; index < turns; index++) {
    for (const mode of ['direct', 'loopback'] as const) {
      const sample = await turn(root, mode);
      samples[mode].push(sample.ms);
      calls[mode] = sample.calls;
    }
  }
  const at = (values: number[], quantile: number) =>
    [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * quantile))]!;
  for (const mode of ['direct', 'loopback'] as const) {
    console.log(`${mode.padEnd(8)} median ${at(samples[mode], 0.5).toFixed(1)} ms  p95 ${at(samples[mode], 0.95).toFixed(1)} ms  host storage calls/turn ${calls[mode]}`);
  }
  const overhead = at(samples.loopback, 0.5) - at(samples.direct, 0.5);
  console.log(`loopback overhead: ${overhead.toFixed(1)} ms per turn, ${(overhead / Math.max(1, calls.loopback)).toFixed(3)} ms per storage call`);
} finally {
  await rm(root, { recursive: true, force: true });
}
