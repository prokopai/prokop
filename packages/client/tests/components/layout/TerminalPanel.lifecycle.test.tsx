import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRef } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { TerminalPanel, type TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import { useConnectionStore } from '@/stores/connectionStore';

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{ dispose: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }>,
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/queries', () => ({ useWorktreesQuery: () => ({ data: [] }) }));
vi.mock('@/hooks/useVisualViewport', () => ({ useVisualViewport: () => ({ height: 900 }) }));
vi.mock('@/hooks/useTerminal', async (original) => {
  const actual = await original<typeof import('@/hooks/useTerminal')>();
  return {
    ...actual,
    createTerminalInstance: () => {
      const element = document.createElement('div');
      element.dataset.testid = 'terminal-output';
      const input = document.createElement('textarea');
      input.setAttribute('aria-label', 'Terminal input');
      element.appendChild(input);
      const terminal = {
        element, open: (container: HTMLElement) => container.appendChild(element),
        dispose: vi.fn(), write: vi.fn(), focus: vi.fn(() => input.focus()), reset: vi.fn(), cols: 80, rows: 24,
        onData: () => ({ dispose: vi.fn() }), onResize: () => ({ dispose: vi.fn() }),
        onSelectionChange: () => ({ dispose: vi.fn() }), hasSelection: () => false,
      };
      mocks.instances.push(terminal);
      return { terminal, fitAddon: { fit: vi.fn() } };
    },
  };
});

type SessionFixture = { id: string; title: string; status: string; cwd: string; shell: string; origin?: string; ownerSessionId?: string };

function createClient(initialSessions?: (workspaceId: string) => SessionFixture[]) {
  const eventListeners = new Map<string, (...args: unknown[]) => void>();
  const eventConnections: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
  const connections: Array<{
    dispose: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    output?: (bytes: Uint8Array) => void;
  }> = [];
  const subscribeEvents = vi.fn(async (workspaceId: string) => {
    const conn = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => { eventListeners.set(event, listener); }),
      dispose: vi.fn(),
    };
    eventConnections.push(conn);
    return {
      conn,
      initialSessions: initialSessions?.(workspaceId)
        ?? [{ id: `${workspaceId}-terminal`, title: 'Shell', status: 'running', cwd: '/work', shell: 'zsh' }],
    };
  });
  const connect = vi.fn(async ({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) => {
    const title = initialSessions?.(workspaceId).find((session) => session.id === sessionId)?.title ?? 'Shell';
    const conn: typeof connections[number] & Record<string, unknown> = {
      dispose: vi.fn(), close: vi.fn(), removeAllListeners: vi.fn(), resize: vi.fn(),
      session: { sessionId, title, cwd: '/work', cols: 80, rows: 24, status: 'running' },
      on: (event: string, listener: (bytes: Uint8Array) => void) => {
        if (event === 'output') conn.output = listener;
      },
    };
    connections.push(conn);
    return conn;
  });
  const deleteTerminal = vi.fn(async () => {});
  const renameTerminal = vi.fn(async () => ({}));
  const client = {
    terminal: { subscribeEvents, connect },
    http: { terminals: { create: vi.fn(), delete: deleteTerminal, rename: renameTerminal } },
  } as unknown as ProkopaiClient;
  const emit = (event: string, ...args: unknown[]) => act(() => { eventListeners.get(event)?.(...args); });
  return { client, subscribeEvents, connect, deleteTerminal, renameTerminal, emit, eventConnections, connections };
}

describe('terminal view lifetime', () => {
  beforeEach(() => {
    mocks.instances.length = 0;
    useConnectionStore.setState({ connected: true });
  });
  afterEach(() => {
    cleanup();
    useConnectionStore.setState(useConnectionStore.getInitialState());
  });

  test('terminal mount and delayed autofocus preserve center focus when the workspace changes', async () => {
    const sdk = createClient();
    const props = { workspacePath: '/work', workspaceName: 'Work', additionalPaths: [], sdkClient: sdk.client, onClose: vi.fn(), keepAlive: true };
    const content = (workspaceId: string) => <>
      <section data-view-group="center"><input aria-label="Chat draft" /></section>
      <section data-view-group="bottom"><TerminalPanel {...props} workspaceId={workspaceId} isOpen /></section>
    </>;
    const { rerender } = render(content('w1'));
    screen.getByRole('textbox', { name: 'Chat draft' }).focus();
    await screen.findByTestId('terminal-output');
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveFocus();
    // Switching center sessions can change the terminal's workspace as well.
    rerender(content('w2'));
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveFocus();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveFocus();
  });

  test('pending terminal autofocus cannot pull focus back after leaving its dock', async () => {
    const sdk = createClient();
    render(<>
      <section data-view-group="center"><input aria-label="Chat draft" /></section>
      <section data-view-group="bottom">
        <button>Terminal tab</button>
        <TerminalPanel workspaceId="w1" workspacePath="/work" workspaceName="Work" additionalPaths={[]} sdkClient={sdk.client} onClose={vi.fn()} isOpen keepAlive />
      </section>
    </>);
    screen.getByRole('button', { name: 'Terminal tab' }).focus();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Terminal input' })).toHaveFocus());
    screen.getByRole('textbox', { name: 'Chat draft' }).focus();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveFocus();
  });

  test('starts on first reveal, receives output while hidden, and disposes only on workspace change or unmount', async () => {
    const sdk = createClient();
    const props = { workspaceId: 'w1', workspacePath: '/work', workspaceName: 'Work', additionalPaths: [], sdkClient: sdk.client, onClose: vi.fn(), keepAlive: true };
    const { rerender, unmount } = render(<TerminalPanel {...props} isOpen={false} />);
    expect(sdk.subscribeEvents).not.toHaveBeenCalled();
    rerender(<TerminalPanel {...props} isOpen />);
    await screen.findByTestId('terminal-output');
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledTimes(1));
    const terminal = mocks.instances[0];
    rerender(<TerminalPanel {...props} isOpen={false} />);
    act(() => sdk.connections[0].output?.(new TextEncoder().encode('background output')));
    expect(terminal.write).toHaveBeenCalledWith('background output');
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(sdk.connections[0].dispose).not.toHaveBeenCalled();
    expect(sdk.eventConnections[0].dispose).not.toHaveBeenCalled();
    rerender(<TerminalPanel {...props} isOpen />);
    expect(sdk.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(sdk.connect).toHaveBeenCalledTimes(1);
    expect(mocks.instances).toHaveLength(1);

    rerender(<TerminalPanel {...props} workspaceId="w2" isOpen={false} />);
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(sdk.eventConnections[0].dispose).toHaveBeenCalledOnce();
    expect(sdk.subscribeEvents).toHaveBeenCalledTimes(1);
    rerender(<TerminalPanel {...props} workspaceId="w2" isOpen />);
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledTimes(2));
    unmount();
    expect(mocks.instances[1].dispose).toHaveBeenCalledOnce();
    expect(sdk.connections[1].dispose).toHaveBeenCalledOnce();
    expect(sdk.deleteTerminal).not.toHaveBeenCalled();
    expect(sdk.connections.every((conn) => conn.close.mock.calls.length === 0)).toBe(true);
  });

  test('explicit terminal close still destroys the server resource', async () => {
    const sdk = createClient();
    render(<TerminalPanel workspaceId="w1" workspacePath="/work" workspaceName="Work" additionalPaths={[]} sdkClient={sdk.client} onClose={vi.fn()} isOpen keepAlive />);
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal Shell' }));
    expect(sdk.deleteTerminal).toHaveBeenCalledWith('w1', 'w1-terminal');
    expect(sdk.connections[0].close).toHaveBeenCalledOnce();
    expect(mocks.instances[0].dispose).toHaveBeenCalledOnce();
  });
});

describe('terminal tabs', () => {
  beforeEach(() => {
    mocks.instances.length = 0;
    useConnectionStore.setState({ connected: true });
  });
  afterEach(() => {
    cleanup();
    useConnectionStore.setState(useConnectionStore.getInitialState());
  });

  const twoTabs = () => [
    { id: 'api', title: 'api', status: 'running', cwd: '/work/api', shell: 'zsh' },
    { id: 'dev', title: 'dev server', status: 'running', cwd: '/work', shell: 'zsh', origin: 'agent', ownerSessionId: 'chat-1' },
  ];

  function renderPanel(sdk: ReturnType<typeof createClient>, ref?: React.Ref<TerminalPanelHandle>) {
    return render(
      <TerminalPanel
        ref={ref}
        workspaceId="w1"
        workspacePath="/work"
        workspaceName="Work"
        additionalPaths={[]}
        sdkClient={sdk.client}
        onClose={vi.fn()}
        isOpen
        keepAlive
      />,
    );
  }

  test('tabs show their own names and mark terminals the agent started', async () => {
    const sdk = createClient(twoTabs);
    renderPanel(sdk);
    const tabs = await screen.findAllByRole('tab');

    expect(tabs.map((tab) => tab.textContent)).toEqual(['api', 'dev server']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Started by an agent')).toBeInTheDocument();
    expect(tabs[1].getAttribute('title')).toContain('Started by an agent');
  });

  test('arrow keys move between tabs and Enter opens the shell', async () => {
    const sdk = createClient(twoTabs);
    renderPanel(sdk);
    const [api, dev] = await screen.findAllByRole('tab');
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledOnce());

    api.focus();
    fireEvent.keyDown(api, { key: 'ArrowRight' });
    expect(dev).toHaveFocus();
    expect(api).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(dev, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /dev server/ })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Terminal input' })).toHaveFocus());
  });

  test('F2 renames through the server and Escape cancels', async () => {
    const sdk = createClient(twoTabs);
    renderPanel(sdk);
    const [api] = await screen.findAllByRole('tab');

    api.focus();
    fireEvent.keyDown(api, { key: 'F2' });
    // The shell mounting after the rename opened must not steal its focus.
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledOnce());
    await screen.findByTestId('terminal-output');
    expect(screen.getByRole('textbox', { name: 'Terminal name' })).toHaveFocus();
    const input = screen.getByRole('textbox', { name: 'Terminal name' });
    fireEvent.change(input, { target: { value: 'ignored' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(sdk.renameTerminal).not.toHaveBeenCalled();
    expect(api).toHaveFocus();

    fireEvent.doubleClick(api);
    const renameInput = screen.getByRole('textbox', { name: 'Terminal name' });
    fireEvent.change(renameInput, { target: { value: '  backend  ' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });

    expect(sdk.renameTerminal).toHaveBeenCalledWith('w1', 'api', 'backend');
    expect(screen.getAllByRole('tab')[0].textContent).toBe('backend');
  });

  test('a terminal the agent opens does not take over the active tab', async () => {
    const sdk = createClient(() => [twoTabs()[0]]);
    renderPanel(sdk);
    await screen.findByRole('tab', { name: /api/ });

    sdk.emit('created', { id: 'agent-1', title: 'tests', status: 'running', cwd: '/work', shell: 'zsh', origin: 'agent', ownerSessionId: 'chat-1' });
    sdk.emit('created', { id: 'user-2', title: 'work', status: 'running', cwd: '/work', shell: 'zsh', origin: 'user' });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['api', 'tests', 'work']);
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  test('switching from inside a shell focuses the next shell', async () => {
    const sdk = createClient(twoTabs);
    const ref = createRef<TerminalPanelHandle>();
    renderPanel(sdk, ref);
    await screen.findAllByRole('tab');
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledOnce());
    const first = await screen.findByRole('textbox', { name: 'Terminal input' });
    first.focus();

    act(() => ref.current!.cycleTab(1));

    await waitFor(() => expect(sdk.connect).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const shell = screen.getByRole('textbox', { name: 'Terminal input' });
      expect(shell).not.toBe(first);
      expect(shell).toHaveFocus();
    });
  });

  test('the handle cycles tabs and wraps around', async () => {
    const sdk = createClient(twoTabs);
    const ref = createRef<TerminalPanelHandle>();
    renderPanel(sdk, ref);
    await screen.findAllByRole('tab');

    act(() => ref.current!.cycleTab(1));
    await waitFor(() => expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true'));
    act(() => ref.current!.cycleTab(1));
    await waitFor(() => expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true'));
  });
});
