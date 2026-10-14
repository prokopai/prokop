import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createHostEndpoint } from '../src/index';
import { createStreamChannel } from '../src/stream';

/** A readable stream that yields the given chunks, then ends (unless `open`). */
function chunks(parts: string[], open = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      if (!open) controller.close();
    },
  });
}

describe('stream channel', () => {
  test('splits lines across chunks, buffers until a receiver, and closes at end of input', async () => {
    const invalid: string[] = [];
    const channel = createStreamChannel({
      readable: chunks(['{"a":1}\n{"b"', ':2}\n\nnot json\n{"c":', '3}']),
      writer: { write: () => {} },
      onInvalidLine: line => invalid.push(line),
    });
    const reason = await channel.closed;
    const received: unknown[] = [];
    channel.receive(message => received.push(message));
    expect(received).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(invalid).toEqual(['not json']);
    expect(reason.message).toBe('Channel closed: end of input');
    expect(() => channel.send({})).toThrow('Channel closed');
  });

  test('send writes one line per message and flushes', () => {
    const written: string[] = [];
    let flushes = 0;
    const channel = createStreamChannel({
      readable: chunks([], true),
      writer: { write: text => written.push(text), flush: () => { flushes++; } },
    });
    channel.send({ jsonrpc: '2.0', method: 'x', params: { text: 'a\nb' } });
    channel.send({ n: 2 });
    expect(written).toEqual(['{"jsonrpc":"2.0","method":"x","params":{"text":"a\\nb"}}\n', '{"n":2}\n']);
    expect(flushes).toBe(2);
    channel.close();
  });

  test('a host endpoint talks to an agent in a real child process, both directions', async () => {
    const child = Bun.spawn(['bun', join(import.meta.dir, 'fixtures/stdio-agent.ts')], {
      stdin: 'pipe', stdout: 'pipe', stderr: 'inherit',
    });
    const host = createHostEndpoint({
      channel: createStreamChannel({ readable: child.stdout, writer: child.stdin }),
      handlers: { 'store.session.get': ({ id }) => ({ id, workspaceId: 'w1', harness: 'prokop', title: 'Hello' }) as never },
    });
    try {
      expect(await host.request('title.native', { sessionId: 's1' })).toEqual({ title: 'native Hello' });
      await host.request('shutdown', {});
      expect(await child.exited).toBe(0);
      expect((await host.closed).message).toBe('Channel closed: end of input');
    } finally {
      child.kill();
    }
  });
});
