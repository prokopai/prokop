import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useConnectionLifecycle } from '@/hooks/useConnectionLifecycle';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { queryClient } from '@/components/providers/QueryProvider';

vi.mock('@/config/client-identity', () => ({
  resolveClientDescriptor: async () => ({ clientId: 'test-client', clientType: 'web' }),
}));
vi.mock('@/hooks/subscribeToServerEvents', () => ({ subscribeToServerEvents: vi.fn() }));
vi.mock('@/lib/refreshWorkspaceActivity', () => ({ refreshWorkspaceActivity: vi.fn().mockResolvedValue(undefined) }));

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: string[] = [];
  constructor() { FakeSocket.instances.push(this); }
  close(): void { this.readyState = 3; }
  send(message: string): void { this.sent.push(message); }
  open(): void { this.readyState = 1; this.onopen?.(); }
}
const latest = () => FakeSocket.instances.at(-1)!;
// Several microtasks: the socket-ticket fetch and its JSON body.
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
const ticket = (value = 'ticket-1') => Response.json({ ticket: value, expiresAt: 0 });
const isTicketRequest = (input: unknown) => String(input).includes('/api/auth/ws-ticket');
/** The ticket request gets `onTicket`; other HTTP calls (the access overview check) get an empty reply. */
function fetchWith(onTicket: () => Promise<Response>) {
  const mock = vi.fn((input: unknown) => isTicketRequest(input) ? onTicket() : Promise.resolve(Response.json({})));
  const ticketCalls = () => mock.mock.calls.filter((call) => isTicketRequest(call[0]));
  vi.stubGlobal('fetch', mock);
  return { ticketCalls };
}
const handleAccessLost = vi.fn();
function mount() {
  return renderHook(() => useConnectionLifecycle({
    apiToken: 'fake',
    serverUrl: 'http://test',
    currentSessionIdRef: { current: null },
    handlerContextRef: { current: null },
    handleLogout: vi.fn(),
    handleAccessLost,
    clientRef: { current: null },
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  // Token holders exchange their token for a single-use socket ticket first.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ticket: 'ticket-1', expiresAt: 0 })));
  handleAccessLost.mockClear();
  FakeSocket.instances = [];
  useConnectionStore.getState().resetConnection();
  useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  useConnectionStore.getState().resetConnection();
  useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connection lifecycle', () => {
  test('shutdown reconnects immediately and restores subscriptions without replaying mutations', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    useSessionBoardStore.setState({ openSessionIds: ['session-1'], focusedSessionId: 'session-1' });
    const hook = mount();
    await flush();
    act(() => latest().open());
    expect(useConnectionStore.getState().connected).toBe(true);
    act(() => latest().onclose?.({ code: 1001, reason: 'Server shutting down', wasClean: true } as CloseEvent));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => latest().open());
    const messages = latest().sent.map(value => JSON.parse(value));
    // The new socket learns who is here; no mutation is replayed.
    expect(messages.map(message => message.type)).toEqual(['client.register', 'session.resume', 'client.attention']);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith();
    expect(useConnectionStore.getState().connected).toBe(true);
    hook.unmount();
  });

  test('the socket opens straight after the ticket, with no separate auth round trip', async () => {
    const fetchMock = vi.fn((input: unknown) => Promise.resolve(isTicketRequest(input) ? ticket() : Response.json({})));
    vi.stubGlobal('fetch', fetchMock);
    const hook = mount();
    await flush();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain('http://test/api/auth/ws-ticket');
    expect(urls).not.toContain('http://test/api/auth/verify');
    expect(FakeSocket.instances).toHaveLength(1);
    hook.unmount();
  });

  test('manual retry replaces a pending ticket request and ignores its late completion', async () => {
    let resolveOld!: (response: Response) => void;
    let first = true;
    fetchWith(() => {
      if (!first) return Promise.resolve(ticket('ticket-2'));
      first = false;
      return new Promise<Response>(resolve => { resolveOld = resolve; });
    });
    const hook = mount();
    await flush();
    expect(FakeSocket.instances).toHaveLength(0);
    act(() => hook.result.current.retry());
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    await act(async () => { resolveOld(ticket()); });
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    hook.unmount();
  });

  test('watchdog replaces an attempt stuck on the ticket request', async () => {
    let first = true;
    fetchWith(() => {
      if (!first) return Promise.resolve(ticket());
      first = false;
      return new Promise<Response>(() => {});
    });
    const hook = mount();
    await flush();
    expect(FakeSocket.instances).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    hook.unmount();
  });

  test('a refused ticket stops automatic retries and asks to pair again', async () => {
    const { ticketCalls } = fetchWith(async () => new Response(JSON.stringify({ message: 'Access revoked' }), { status: 401 }));
    const hook = mount();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(ticketCalls()).toHaveLength(1);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(useConnectionStore.getState().authError).toContain('no longer paired');
    expect(handleAccessLost).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  test('a failed ticket request retries without an auth error', async () => {
    let first = true;
    fetchWith(() => {
      if (!first) return Promise.resolve(ticket());
      first = false;
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    const hook = mount();
    await flush();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(useConnectionStore.getState().authError).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    hook.unmount();
  });
});
