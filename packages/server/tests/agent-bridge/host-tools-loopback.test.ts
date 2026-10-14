import { afterEach, describe, expect, test } from 'bun:test';
import type { WorkspaceMcpTool } from '@prokopai/core/application/ports/mcp-tools';
import { createProtocolSessionSearchHost, createProtocolTerminals, createProtocolToolDiscovery } from '@/agent/protocol/tools';
import { createToolHostHandlers, type HostToolServices, type TerminalAccess, type ToolAccessContext } from '@/agent-bridge/host-tools';
import { createAgentLoopback } from '@/agent-bridge/loopback';
import { capabilityToolFromMcp } from '@prokopai/core/infrastructure/mcp/capability-tool';

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const context: ToolAccessContext = { workspaceId: 'ws1', preconfigId: 'agent-a', path: '/work' };
const runOptions = { toolCallId: 'call-1', messages: [] } as never;

function echoTool(onSignal?: (signal?: AbortSignal) => void): WorkspaceMcpTool {
  return {
    name: 'srv__echo', serverName: 'srv', toolName: 'echo', description: 'Echo input.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    async execute(input, signal) {
      onSignal?.(signal);
      if (input.slow) {
        return await new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped'))));
      }
      return { content: [{ type: 'text', text: `echo ${String(input.text)}` }], structuredContent: { echoed: input.text } };
    },
  };
}

function connect(services: Partial<HostToolServices>) {
  const terminals = {} as TerminalAccess;
  const { agent, close } = createAgentLoopback({
    handlers: createToolHostHandlers({
      mcp: { grant: async () => null, check: async () => false, tools: async () => [] },
      sessionSearch: {} as HostToolServices['sessionSearch'],
      applyKnowledge: async () => ({}),
      terminals,
      ...services,
    }),
  });
  closers.push(close);
  return agent;
}

async function discover(agent: ReturnType<typeof connect>) {
  const discovery = createProtocolToolDiscovery(agent);
  if (!discovery.discoverTools) throw new Error('Protocol discovery must discover tools');
  return discovery.discoverTools('/work', 's1');
}

describe('MCP tools over the agent protocol', () => {
  test('a proxied tool returns exactly what the in-process tool returns', async () => {
    const tool = echoTool();
    const allowed = true;
    const agent = connect({
      mcp: { grant: async () => context, check: async () => allowed, tools: async () => [tool] },
    });
    const discovered = await discover(agent);
    const direct = capabilityToolFromMcp(tool, { authorized: async () => allowed, call: (input, signal) => tool.execute(input, signal) });

    expect(Object.keys(discovered)).toEqual(['srv__echo']);
    const viaProtocol = await discovered.srv__echo!.execute!({ text: 'hi' }, runOptions);
    expect(viaProtocol).toEqual(await direct.execute!({ text: 'hi' }, runOptions));
    expect(viaProtocol).toMatchObject({ content: [{ type: 'text', text: 'echo hi' }] });
    expect(discovered.srv__echo!.toModelOutput).toBe(direct.toModelOutput);
  });

  test('no access grant means no tools', async () => {
    const agent = connect({ mcp: { grant: async () => null, check: async () => true, tools: async () => [echoTool()] } });
    expect(await discover(agent)).toEqual({});
  });

  test('revoked access stops calls on the host', async () => {
    let allowed = true;
    const agent = connect({ mcp: { grant: async () => context, check: async () => allowed, tools: async () => [echoTool()] } });
    const discovered = await discover(agent);
    allowed = false;
    await expect(discovered.srv__echo!.execute!({ text: 'hi' }, runOptions)).rejects.toThrow('MCP access is not allowed for this agent');
  });

  test('aborting a call aborts the host-side tool', async () => {
    let hostSignal: AbortSignal | undefined;
    const agent = connect({
      mcp: { grant: async () => context, check: async () => true, tools: async () => [echoTool(signal => { hostSignal = signal; })] },
    });
    const discovered = await discover(agent);
    const controller = new AbortController();
    const call = discovered.srv__echo!.execute!({ slow: true }, { ...runOptions as object, abortSignal: controller.signal } as never);
    await Bun.sleep(5);
    controller.abort();
    await expect(call).rejects.toThrow('Request cancelled');
    await Bun.sleep(5);
    expect(hostSignal?.aborted).toBe(true);
  });
});

describe('session search over the agent protocol', () => {
  test('port calls return the host values, null included', async () => {
    const hits = [{ messageId: 'm1', sessionId: 's1', workspaceId: 'ws1', role: 'user', content: 'hello', timestamp: 1, sessionTitle: null, rank: 0.5 }];
    const host = {
      searchMessages: async (options: unknown) => ((options as { query: string }).query === 'hello' ? hits : []),
      getSession: async () => null,
      countMessagesBefore: async (sessionId: unknown, timestamp: unknown) => (sessionId === 's1' ? Number(timestamp) * 2 : 0),
    };
    const search = createProtocolSessionSearchHost(connect({ sessionSearch: host as unknown as HostToolServices['sessionSearch'] }));
    expect(await search.searchMessages({ query: 'hello', roleFilter: ['user'], limit: 5, sort: 'relevance' })).toEqual(hits);
    expect(await search.getSession('missing')).toBeNull();
    expect(await search.countMessagesBefore('s1', 21)).toBe(42);
  });
});

describe('terminals over the agent protocol', () => {
  function fakeTerminals(): TerminalAccess {
    const sessions = new Map<string, { id: string; title: string; cwd: string; status: string; buffer: string; execCwd: string | null }>();
    return {
      create: async (options) => {
        const id = `t${sessions.size + 1}`;
        sessions.set(id, { id, title: options.title ?? 'Terminal', cwd: options.cwd, status: 'running', buffer: '', execCwd: null });
        return id;
      },
      get: async (id) => {
        const session = sessions.get(id);
        return session ? { id, title: session.title, cwd: session.cwd, status: session.status, origin: 'agent' } : null;
      },
      executionCwd: async id => sessions.get(id)?.execCwd ?? null,
      setCwd: async (id, cwd) => {
        const session = sessions.get(id);
        if (!session) return false;
        session.execCwd = cwd;
        return true;
      },
      write: async (id, data) => {
        const session = sessions.get(id);
        if (!session) return false;
        session.buffer += data;
        return true;
      },
      read: async (id, fromOffset, maxBytes) => {
        const session = sessions.get(id);
        if (!session) return null;
        const text = session.buffer.slice(fromOffset, fromOffset + maxBytes);
        return { text, nextOffset: fromOffset + text.length, totalBytes: session.buffer.length };
      },
      list: async cwd => [...sessions.values()].filter(session => session.cwd === cwd)
        .map(({ id, title, status }) => ({ id, title, cwd, status, origin: 'agent' as const })),
      destroy: async (id) => {
        sessions.delete(id);
      },
    };
  }

  async function script(terminals: TerminalAccess): Promise<unknown[]> {
    const id = await terminals.create({ cwd: '/work', workspaceId: 'ws1', origin: 'agent', title: 'build' });
    return [
      id,
      await terminals.get(id!),
      await terminals.read(id!, 0, 0),
      await terminals.write(id!, 'echo hi\n'),
      await terminals.read(id!, 0, Number.MAX_SAFE_INTEGER),
      await terminals.setCwd(id!, '/work/sub'),
      await terminals.executionCwd(id!),
      await terminals.list('/work'),
      await terminals.destroy(id!),
      await terminals.get(id!),
      await terminals.read(id!, 0, 10),
    ];
  }

  test('every terminal operation returns the same through the protocol', async () => {
    const direct = await script(fakeTerminals());
    const viaProtocol = await script(createProtocolTerminals(connect({ terminals: fakeTerminals() })));
    expect(direct[4]).toEqual({ text: 'echo hi\n', nextOffset: 8, totalBytes: 8 });
    expect(JSON.parse(JSON.stringify(viaProtocol))).toEqual(JSON.parse(JSON.stringify(direct)));
  });
});
