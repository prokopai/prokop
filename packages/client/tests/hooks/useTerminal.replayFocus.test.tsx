import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useTerminalConnection } from '@/hooks/useTerminal';

function makeTerminal() {
  const element = document.createElement('div');
  const input = document.createElement('textarea');
  element.appendChild(input);
  document.body.appendChild(element);
  const terminal = {
    element,
    cols: 80,
    rows: 24,
    reset: vi.fn(),
    focus: vi.fn(() => input.focus()),
    // Browsers blur a focused element once it is hidden; the replay hides
    // the xterm while it rewrites the buffer.
    write: vi.fn((_data: string, callback?: () => void) => {
      if (element.style.visibility === 'hidden') input.blur();
      callback?.();
    }),
    onData: () => ({ dispose: vi.fn() }),
    onResize: () => ({ dispose: vi.fn() }),
  };
  return { terminal: terminal as unknown as Terminal, input, element };
}

function makeClient() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const connection = {
    isReconnect: true,
    status: 'running',
    closed: false,
    session: { sessionId: 's1', title: 'api', cwd: '/work', cols: 80, rows: 24, status: 'running', isReconnect: true },
    on: (event: string, listener: (...args: unknown[]) => void) => { listeners.set(event, listener); },
    resize: vi.fn(),
    removeAllListeners: vi.fn(),
    dispose: vi.fn(),
  };
  const client = { terminal: { connect: vi.fn(async () => connection) } } as unknown as ProkopaiClient;
  return { client, listeners };
}

function Harness({ terminal, client, onReady }: {
  terminal: Terminal;
  client: ProkopaiClient;
  onReady: (connect: (id: string) => void) => void;
}) {
  const { connect } = useTerminalConnection(terminal, {
    terminal,
    sdkClient: client,
    workspaceId: 'w1',
    cwd: '/work',
    serverSessionId: 's1',
    onOutput: vi.fn(),
    onStatusChange: vi.fn(),
  });
  onReady(connect);
  return null;
}

describe('terminal replay focus', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  async function replay(focusBefore: () => void) {
    const { terminal, input, element } = makeTerminal();
    const { client, listeners } = makeClient();
    let connect: (id: string) => void = () => {};
    render(<Harness terminal={terminal} client={client} onReady={(fn) => { connect = fn; }} />);
    await act(async () => { connect('s1'); });
    focusBefore();
    act(() => {
      listeners.get('output')?.(new TextEncoder().encode('$ ls\r\n'));
      listeners.get('replay_complete')?.();
    });
    return { input, element };
  }

  test('a shell focused before the replay keeps focus after it', async () => {
    const { input, element } = await replay(() => {
      document.querySelector('textarea')!.focus();
    });
    expect(element.style.visibility).toBe('');
    expect(input).toHaveFocus();
  });

  test('the replay does not take focus the shell did not have', async () => {
    const other = document.createElement('input');
    document.body.appendChild(other);
    const { input } = await replay(() => other.focus());
    expect(other).toHaveFocus();
    expect(input).not.toHaveFocus();
  });
});
