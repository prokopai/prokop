import { describe, expect, test } from 'bun:test';
import {
  createAgentEndpoint, createHostEndpoint, createLoopback, RpcErrorCode, RpcRequestError,
  type AgentHandlers, type HostHandlers,
} from '../src/index';

const session = { id: 's1', workspaceId: 'w1', harness: 'prokop' as const, title: 'Hello' };

function pair(options: {
  host?: HostHandlers;
  agent?: AgentHandlers;
  delivered?: unknown[];
  protocolErrors?: Error[];
} = {}) {
  const [hostChannel, agentChannel] = createLoopback();
  const host = createHostEndpoint({
    channel: hostChannel,
    handlers: options.host ?? {},
    notifications: { deliver: params => options.delivered?.push(params) },
    onProtocolError: error => options.protocolErrors?.push(error),
  });
  const agent = createAgentEndpoint({
    channel: agentChannel,
    handlers: options.agent ?? {},
    onProtocolError: error => options.protocolErrors?.push(error),
  });
  return { host, agent, hostChannel, agentChannel };
}

async function rejection(promise: Promise<unknown>): Promise<RpcRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcRequestError) return error;
    throw error;
  }
  throw new Error('Expected the request to fail');
}

describe('requests', () => {
  test('agent calls a host method and gets the parsed result', async () => {
    const { agent } = pair({ host: { 'store.session.get': ({ id }) => (id === 's1' ? session : null) } });
    expect(await agent.request('store.session.get', { id: 's1' }) as unknown).toEqual(session);
    expect(await agent.request('store.session.get', { id: 'other' })).toBeNull();
  });

  test('host calls an agent method', async () => {
    const { host } = pair({ agent: { 'title.native': ({ sessionId }) => ({ title: `native ${sessionId}` }) } });
    expect(await host.request('title.native', { sessionId: 's1' })).toEqual({ title: 'native s1' });
  });

  test('values cross as JSON, like stdio', async () => {
    const { agent } = pair({
      host: { 'store.message.update': ({ updates }) => ({ id: 'm1', sessionId: 's1', role: 'user', ...updates }) },
    });
    const result = await agent.request('store.message.update', {
      id: 'm1', updates: { completedAt: new Date(0), dropped: undefined, fn: () => 1 },
    }) as unknown as Record<string, unknown>;
    expect(result.completedAt).toBe('1970-01-01T00:00:00.000Z');
    expect('dropped' in result).toBe(false);
    expect('fn' in result).toBe(false);
  });

  test('invalid params are rejected before the handler runs', async () => {
    let called = false;
    const { agent } = pair({ host: { 'store.session.get': () => { called = true; return null; } } });
    const error = await rejection(agent.request('store.session.get', { id: 42 } as never));
    expect(error.code).toBe(RpcErrorCode.InvalidParams);
    expect(called).toBe(false);
  });

  test('a method without a handler answers MethodNotFound', async () => {
    const { agent } = pair();
    expect((await rejection(agent.request('store.session.get', { id: 's1' }))).code).toBe(RpcErrorCode.MethodNotFound);
  });

  test('a throwing handler answers InternalError with its message', async () => {
    const { agent } = pair({ host: { 'store.session.get': () => { throw new Error('database is locked'); } } });
    const error = await rejection(agent.request('store.session.get', { id: 's1' }));
    expect(error.code).toBe(RpcErrorCode.InternalError);
    expect(error.message).toBe('database is locked');
  });

  test('a result that breaks the schema is rejected on the requesting side', async () => {
    const { agent } = pair({ host: { 'store.message.delete': () => ({ deleted: 'yes' }) as never } });
    expect((await rejection(agent.request('store.message.delete', { id: 'm1' }))).code).toBe(RpcErrorCode.InvalidResult);
  });
});

describe('ordering', () => {
  test('synchronous handlers apply writes in send order, interleaved with notifications', async () => {
    const log: string[] = [];
    const delivered: unknown[] = [];
    const { agent } = pair({
      delivered,
      host: {
        'store.index.sync': ({ messageId }) => { log.push(`write ${messageId}`); return {}; },
      },
    });
    const writes: Promise<unknown>[] = [];
    for (let index = 0; index < 50; index++) {
      writes.push(agent.request('store.index.sync', { messageId: String(index) }));
      agent.notify('deliver', { seq: index, audience: { scope: 'session', sessionId: 's1' },
        message: { type: 'part.append', sessionId: 's1', partId: 'p1', field: 'text', delta: String(index) } });
    }
    await Promise.all(writes);
    expect(log).toEqual(Array.from({ length: 50 }, (_, index) => `write ${index}`));
    expect(delivered.map(entry => (entry as { seq: number }).seq)).toEqual(Array.from({ length: 50 }, (_, index) => index));
  });
});

describe('cancellation', () => {
  test('aborting a request cancels it on both sides', async () => {
    let handlerSignal: AbortSignal | null = null;
    const { agent } = pair({
      host: {
        'tool.call': (_params, { signal }) => {
          handlerSignal = signal;
          return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped'))));
        },
      },
    });
    const controller = new AbortController();
    const call = agent.request('tool.call', { source: 'mcp', name: 'slow', workspacePath: '/w', arguments: {} },
      { signal: controller.signal });
    await Bun.sleep(1);
    controller.abort();
    expect((await rejection(call)).code).toBe(RpcErrorCode.Cancelled);
    await Bun.sleep(1);
    expect((handlerSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  test('a timeout cancels the request', async () => {
    const { agent } = pair({ host: { 'tool.call': () => new Promise(() => {}) } });
    const error = await rejection(agent.request('tool.call',
      { source: 'mcp', name: 'slow', workspacePath: '/w', arguments: {} }, { timeoutMs: 5 }));
    expect(error.code).toBe(RpcErrorCode.Cancelled);
  });
});

describe('close', () => {
  test('in-flight and later requests fail with ChannelClosed, and handlers see the abort', async () => {
    let handlerSignal: AbortSignal | null = null;
    const { host, agent } = pair({
      agent: {
        'turn.start': (_params, { signal }) => { handlerSignal = signal; return new Promise(() => {}); },
      },
    });
    const turn = host.request('turn.start', {
      harness: 'prokop', origin: null, sessionId: 's1', content: 'hi',
    });
    await Bun.sleep(1);
    agent.close(new Error('agent exited'));
    const error = await rejection(turn);
    expect(error.code).toBe(RpcErrorCode.ChannelClosed);
    expect(error.message).toBe('agent exited');
    expect((handlerSignal as AbortSignal | null)?.aborted).toBe(true);
    expect((await rejection(agent.request('store.session.get', { id: 's1' }))).code).toBe(RpcErrorCode.ChannelClosed);
  });
});

describe('malformed traffic', () => {
  test('is reported locally and never answered', async () => {
    const protocolErrors: Error[] = [];
    const { agentChannel } = pair({ protocolErrors });
    agentChannel.send({ hello: 'world' });
    agentChannel.send({ jsonrpc: '2.0', method: 'deliver', params: { seq: -1 } });
    await Bun.sleep(1);
    expect(protocolErrors.map(error => error.message)).toEqual([
      'Invalid JSON-RPC message',
      'Invalid params for notification deliver',
    ]);
  });
});
