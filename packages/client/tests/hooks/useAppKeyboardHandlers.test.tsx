import { createRef } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { KeyboardShortcutsConfig } from '@/hooks/useKeyboardShortcuts';
import { useAppKeyboardHandlers } from '@/hooks/useAppKeyboardHandlers';
import { WorkspaceViews } from '@/components/app/WorkspaceViews';
import {
  SessionPaneRegistryContext,
  type SessionPaneRegistry,
} from '@/contexts/SessionPaneRegistryContext';
import { createDefaultViewLayout, groupViewId, sessionViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { DOCK_POSITIONS, useDockStore } from '@/stores/dockStore';
import { useWorkspaceFocusStore } from '@/stores/workspaceFocusStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

const originalWidth = window.innerWidth;
afterEach(() => {
  cleanup();
  useWorkspaceFocusStore.setState(useWorkspaceFocusStore.getInitialState());
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  useDockStore.setState(useDockStore.getInitialState());
  useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
  useSessionBoardStore.setState(useSessionBoardStore.getInitialState());
  vi.mocked(paneRegistry.getHandle).mockReset();
});

const mocks = vi.hoisted(() => ({
  keyboardConfig: null as KeyboardShortcutsConfig | null,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    state: { location: { pathname: '/server/server-1/workspace' } },
    navigate: vi.fn(),
  }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ serverId: 'server-1' }),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: '/server/server-1/workspace' } }),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: (config: KeyboardShortcutsConfig) => {
    mocks.keyboardConfig = config;
  },
}));

vi.mock('@/hooks/useBoardFocus', () => ({
  useBoardFocus: () => vi.fn(),
}));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

const paneRegistry: SessionPaneRegistry = {
  panes: new Map(),
  register: vi.fn(),
  unregister: vi.fn(),
  getHandle: vi.fn(),
};

function Harness({ handleInterruptSession = vi.fn() }: { handleInterruptSession?: () => void } = {}) {
  useAppKeyboardHandlers({
    sidebarRef: createRef(),
    terminalPanelRef: createRef(),
    filesPanelRef: createRef(),
    chatInputRef: createRef(),
    activeWorkspace: null,
    primaryPreconfigs: [],
    handleInterruptSession,
    serverId: 'server-1',
    createSession: vi.fn(),
  });
  return null;
}

function renderHarness() {
  return render(
    <SessionPaneRegistryContext.Provider value={paneRegistry}>
      <Harness />
      <div data-mobile-surface="sessions" tabIndex={-1}>
        <button type="button" data-sidebar="menu-button">
          Session one
        </button>
      </div>
    </SessionPaneRegistryContext.Provider>,
  );
}

describe('useAppKeyboardHandlers phone Sessions surface', () => {
  beforeEach(() => {
    mocks.keyboardConfig = null;
    useWorkspaceViewStore.setState({ mobileSurface: 'chat' });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    });
  });

  test('Mod+1 handler opens the Sessions surface', () => {
    renderHarness();

    act(() => mocks.keyboardConfig?.onFocusLeftDock());

    expect(useWorkspaceViewStore.getState().mobileSurface).toBe('sessions');
  });

  test('Shift+Escape handler returns focused Sessions to Chat', () => {
    const { getByRole } = renderHarness();
    useWorkspaceViewStore.setState({ mobileSurface: 'sessions' });
    getByRole('button', { name: 'Session one' }).focus();

    act(() => mocks.keyboardConfig?.onCloseFocusedDock());

    expect(useWorkspaceViewStore.getState().mobileSurface).toBe('chat');
  });
});

describe('useAppKeyboardHandlers positional docks', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    useDockStore.setState(useDockStore.getInitialState());
  });

  test('transcript clicks transfer focus from bottom to center, including through view portals', () => {
    const store = useWorkspaceViewStore.getState();
    store.activateView('conversations');
    store.moveView('editor', 'center');
    store.activateView('conversations');
    store.moveView('usage', 'bottom');
    store.activateView('terminals');
    const { getByRole, getByText } = render(
      <SessionPaneRegistryContext.Provider value={paneRegistry}>
        <Harness />
        <WorkspaceViews views={{ conversations: <p>Transcript</p>, editor: <p>File</p>, terminals: <input aria-label="Terminal" />, usage: <p>Usage content</p> }} />
      </SessionPaneRegistryContext.Provider>,
    );
    const center = getByText('Transcript').closest('[data-view-group]')!;
    const bottom = getByRole('textbox', { name: 'Terminal' }).closest('[data-view-group]')!;
    act(() => getByRole('textbox', { name: 'Terminal' }).focus());
    expect(bottom).toHaveAttribute('data-dock-focused', 'true');
    fireEvent.pointerDown(getByText('Transcript'));
    expect(center).toHaveAttribute('data-dock-focused', 'true');
    expect(bottom).toHaveAttribute('data-dock-focused', 'false');
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => mocks.keyboardConfig?.onFocusTab(1));
    expect(getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tab', { name: 'Terminals' })).toHaveAttribute('aria-selected', 'true');
  });

  test('number and cycle shortcuts follow mixed tab order in the focused split', () => {
    const store = useWorkspaceViewStore.getState();
    store.activateView('conversations');
    store.moveView('editor', 'center');
    store.moveView('explorer', 'center');
    const { getByRole } = render(
      <SessionPaneRegistryContext.Provider value={paneRegistry}>
        <Harness />
        <WorkspaceViews views={{
          conversations: <input aria-label="Session draft" />,
          editor: <input aria-label="File draft" />,
          explorer: <input aria-label="Explorer content" />,
        }} />
      </SessionPaneRegistryContext.Provider>,
    );
    getByRole('textbox', { name: 'Explorer content' }).focus();
    act(() => mocks.keyboardConfig?.onFocusTab(1));
    expect(getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tab', { name: 'Editor' })).toHaveFocus();
    act(() => mocks.keyboardConfig?.onCycleTab(1));
    expect(getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
    act(() => mocks.keyboardConfig?.onCycleTab(1));
    expect(getByRole('tab', { name: 'Conversations' })).toHaveAttribute('aria-selected', 'true');
    act(() => store.splitView('explorer', 'right', ['conversations', 'editor', 'explorer']));
    getByRole('textbox', { name: 'Explorer content' }).focus();
    const layout = useWorkspaceViewStore.getState().layout;
    act(() => mocks.keyboardConfig?.onFocusTab(1));
    expect(useWorkspaceViewStore.getState().layout).toBe(layout);
    act(() => mocks.keyboardConfig?.onFocusTab(0));
    expect(getByRole('tab', { name: 'Explorer' })).toHaveFocus();
    act(() => {
      store.hideView('editor');
      store.activateView('conversations');
    });
    getByRole('textbox', { name: 'Session draft' }).focus();
    act(() => mocks.keyboardConfig?.onFocusTab(8));
    expect(getByRole('textbox', { name: 'Session draft' })).toHaveFocus();
    const group = getByRole('textbox', { name: 'Session draft' }).closest('[data-view-group]')!;
    const visibleTabs = group.querySelectorAll<HTMLButtonElement>('[data-workspace-tab-id] > [role="tab"]');
    expect(Array.from(visibleTabs, (tab) => tab.getAttribute('aria-label'))).not.toContain('Editor');
    act(() => mocks.keyboardConfig?.onFocusTab(0));
    expect(visibleTabs[0]).toHaveFocus();
  });

  test.each(DOCK_POSITIONS)('closes the focused %s dock regardless of its content', (position) => {
    for (const dock of DOCK_POSITIONS) useDockStore.getState().setDockOpen(dock, true);
    const { getByRole } = render(
      <SessionPaneRegistryContext.Provider value={paneRegistry}>
        <Harness />
        <section data-dock-position={position}><div data-workspace-view="terminals"><button type="button">Any view</button></div></section>
      </SessionPaneRegistryContext.Provider>,
    );
    getByRole('button', { name: 'Any view' }).focus();
    act(() => mocks.keyboardConfig?.onCloseFocusedDock());
    for (const dock of DOCK_POSITIONS) {
      expect(useDockStore.getState().docks[dock].open).toBe(dock !== position);
    }
  });

  test.each(DOCK_POSITIONS)('focuses the %s dock without changing moved tabs', async (position) => {
    const store = useWorkspaceViewStore.getState();
    store.moveView('sessions', 'right');
    store.moveView('terminals', 'center');
    store.hideView('terminals');
    for (const dock of DOCK_POSITIONS) useDockStore.getState().setDockOpen(dock, false);
    const layout = useWorkspaceViewStore.getState().layout;
    const { getByRole } = render(
      <SessionPaneRegistryContext.Provider value={paneRegistry}>
        <Harness />
        <section data-dock-position={position}><button role="tab" aria-selected="true">Selected tab</button></section>
      </SessionPaneRegistryContext.Provider>,
    );
    const callbacks = {
      left: mocks.keyboardConfig!.onFocusLeftDock,
      right: mocks.keyboardConfig!.onFocusRightDock,
      bottom: mocks.keyboardConfig!.onFocusBottomDock,
    };
    act(() => callbacks[position]());
    await waitFor(() => expect(getByRole('tab')).toHaveFocus());
    expect(useWorkspaceViewStore.getState().layout).toBe(layout);
    for (const dock of DOCK_POSITIONS) expect(useDockStore.getState().docks[dock].open).toBe(dock === position);
  });

  test('closing a focused dock leaves center editors untouched', () => {
    useWorkspaceViewStore.getState().activateView('editor');
    const { getByRole } = render(
      <SessionPaneRegistryContext.Provider value={paneRegistry}>
        <Harness />
        <div data-workspace-view="editor"><button type="button">Editor content</button></div>
      </SessionPaneRegistryContext.Provider>,
    );
    getByRole('button', { name: 'Editor content' }).focus();
    act(() => mocks.keyboardConfig?.onCloseFocusedDock());
    expect(useWorkspaceViewStore.getState().layout.hidden).not.toContain('editor');
    expect(useDockStore.getState().docks.left.open).toBe(true);
  });

  test('the focus-input shortcut reaches the group chat in front instead of revealing the last focused session', async () => {
    const groupId = groupViewId('server-1', 'g1');
    const groupHandle = { focusInput: vi.fn(), scrollToBottom: vi.fn(), toggleAutoFollow: vi.fn() };
    const sessionHandle = { focusInput: vi.fn(), scrollToBottom: vi.fn(), toggleAutoFollow: vi.fn() };
    vi.mocked(paneRegistry.getHandle).mockImplementation((id) => (id === groupId ? groupHandle : id === 'sess-other' ? sessionHandle : undefined));
    useSessionBoardStore.getState().hydrateFromRoute('sess-other', ['sess-other']);
    useWorkspaceViewStore.getState().openInCenter(groupId);
    useWorkspaceFocusStore.getState().focusGroup('center');
    renderHarness();

    act(() => mocks.keyboardConfig?.onFocusChatInput());
    await waitFor(() => expect(groupHandle.focusInput).toHaveBeenCalled());
    expect(sessionHandle.focusInput).not.toHaveBeenCalled();
    expect(useWorkspaceViewStore.getState().layout.groups.center.activeId).toBe(groupId);

    // With a session in front again, the shortcut goes to that session as before.
    useWorkspaceViewStore.getState().activateView(sessionViewId('server-1', 'sess-other'));
    act(() => mocks.keyboardConfig?.onFocusChatInput());
    await waitFor(() => expect(sessionHandle.focusInput).toHaveBeenCalled());
  });

  test('the stop shortcut stops the group chat in front instead of the last focused session', () => {
    const groupId = groupViewId('server-1', 'g1');
    const groupHandle = { focusInput: vi.fn(), scrollToBottom: vi.fn(), toggleAutoFollow: vi.fn(), stop: vi.fn() };
    vi.mocked(paneRegistry.getHandle).mockImplementation((id) => (id === groupId ? groupHandle : undefined));
    const interrupt = vi.fn();
    useWorkspaceViewStore.getState().openInCenter(groupId);
    useWorkspaceFocusStore.getState().focusGroup('center');
    render(
      <SessionPaneRegistryContext.Provider value={paneRegistry}>
        <Harness handleInterruptSession={interrupt} />
      </SessionPaneRegistryContext.Provider>,
    );

    act(() => mocks.keyboardConfig?.onStopStreaming());
    expect(groupHandle.stop).toHaveBeenCalledTimes(1);
    expect(interrupt).not.toHaveBeenCalled();

    useWorkspaceViewStore.getState().activateView(sessionViewId('server-1', 'sess-other'));
    act(() => mocks.keyboardConfig?.onStopStreaming());
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  test('with the group composer focused inside the real view host, the stop and focus shortcuts reach the group', async () => {
    const groupId = groupViewId('server-1', 'g1');
    const groupHandle = { focusInput: vi.fn(), scrollToBottom: vi.fn(), toggleAutoFollow: vi.fn(), stop: vi.fn() };
    vi.mocked(paneRegistry.getHandle).mockImplementation((id) => (id === groupId ? groupHandle : undefined));
    const interrupt = vi.fn();
    useSessionBoardStore.getState().hydrateFromRoute('sess-other', ['sess-other']);
    useWorkspaceViewStore.getState().openInCenter(groupId);
    const { getByLabelText } = render(
      <SessionPaneRegistryContext.Provider value={paneRegistry}>
        <Harness handleInterruptSession={interrupt} />
        <WorkspaceViews views={{ conversations: <p>Transcript</p>, [groupId]: <textarea aria-label="Group composer" data-chat-input="true" /> }} />
      </SessionPaneRegistryContext.Provider>,
    );
    const composer = getByLabelText('Group composer');
    fireEvent.pointerDown(composer);
    act(() => composer.focus());
    expect(composer.closest('[data-view-group]')).toHaveAttribute('data-dock-focused', 'true');

    act(() => mocks.keyboardConfig?.onStopStreaming());
    expect(groupHandle.stop).toHaveBeenCalledTimes(1);
    expect(interrupt).not.toHaveBeenCalled();
  });

  test('left and bottom shortcuts open their docks', () => {
    useDockStore.getState().setDockOpen('left', false);
    renderHarness();
    act(() => mocks.keyboardConfig?.onFocusLeftDock());
    act(() => mocks.keyboardConfig?.onFocusBottomDock());
    expect(useDockStore.getState().docks.left.open).toBe(true);
    expect(useDockStore.getState().docks.bottom.open).toBe(true);
  });
});
