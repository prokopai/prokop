import {useCallback, useEffect, useLayoutEffect, useRef} from 'react';
import {useRouter} from '@tanstack/react-router';
import { isWorkspaceViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore, type DockPosition } from '@/stores/dockStore';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {useServerDataStore, selectActiveWorkspace } from '@/stores/serverDataStore';
import type {AppSidebarHandle} from '@/components/layout/AppSidebar';
import type {Preconfig, Workspace} from '@prokopai/sdk';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';
import { subscribeLaunchActions, takeLaunchAction } from '@/lib/launchState';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionPaneRegistry } from '@/contexts/SessionPaneRegistryContext';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useWorkspaceFocusStore } from '@/stores/workspaceFocusStore';
import type { TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import { isMobileViewport } from '@/lib/viewport';

function focusedWorkspaceGroup(): HTMLElement | undefined {
  const groupId = useWorkspaceFocusStore.getState().groupId;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-view-group]'))
    .find((group) => group.dataset.viewGroup === groupId && !group.closest('[inert], [hidden], [aria-hidden="true"]'));
}

export interface AppKeyboardHandlersConfig {
  sidebarRef: React.RefObject<AppSidebarHandle | null>;
  terminalPanelRef: React.RefObject<TerminalPanelHandle | null>;
  filesPanelRef: React.RefObject<{ focus: () => void } | null>;
  chatInputRef: React.RefObject<{ focus: () => void } | null>;
  activeWorkspace: Workspace | null;
  primaryPreconfigs: Preconfig[];
  handleInterruptSession: () => void;
  serverId: string;
  createSession: (preconfigId?: string, title?: string) => void;
  onToggleAutoFollow?: () => void;
}

export function useAppKeyboardHandlers({
  sidebarRef,
  terminalPanelRef,
  filesPanelRef,
  chatInputRef,
  activeWorkspace,
  primaryPreconfigs,
  handleInterruptSession,
  serverId,
  createSession,
  onToggleAutoFollow,
}: AppKeyboardHandlersConfig) {
  const paneRegistry = useSessionPaneRegistry();

  // The same Sessions list serves both layouts; showView picks the dock or the surface.
  const focusSidebarSessionPanel = useCallback(() => {
    useWorkspaceViewStore.getState().showView('sessions');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sidebarRef.current?.focusSessionPanel();
      });
    });
  }, [sidebarRef]);

  const focusTerminalPanel = useCallback(() => {
    useWorkspaceViewStore.getState().showView('terminals');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        terminalPanelRef.current?.focus();
      });
    });
  }, [terminalPanelRef]);

  const focusSidebarSessionPanelRef = useRef(focusSidebarSessionPanel);
  useLayoutEffect(() => {
    focusSidebarSessionPanelRef.current = focusSidebarSessionPanel;
  });

  const focusTerminalPanelRef = useRef(focusTerminalPanel);
  useLayoutEffect(() => {
    focusTerminalPanelRef.current = focusTerminalPanel;
  });

  const focusFilesPanel = useCallback(() => {
    requestAnimationFrame(() => {
      filesPanelRef.current?.focus();
    });
  }, [filesPanelRef]);

  const focusFilesPanelRef = useRef(focusFilesPanel);
  useLayoutEffect(() => {
    focusFilesPanelRef.current = focusFilesPanel;
  });

  const focusChatInput = useCallback(() => {
    // The phone returns to Chat; on desktop the surface is unused.
    useWorkspaceViewStore.getState().setMobileSurface('chat');
    const focusedSessionId = useSessionBoardStore.getState().focusedSessionId;
    if (focusedSessionId) useSessionBoardStore.getState().focusSession(focusedSessionId);
    requestAnimationFrame(() => {
      const focusedPane = focusedSessionId ? paneRegistry.getHandle(focusedSessionId) : undefined;
      if (focusedPane) focusedPane.focusInput();
      else chatInputRef.current?.focus();
    });
  }, [chatInputRef, paneRegistry]);

  const handleNewSession = useCallback(() => {
    if (activeWorkspace) {
      const defaultId = getWorkspaceDefaultPreconfigId(activeWorkspace, primaryPreconfigs);
      if (defaultId) createSession(defaultId);
    }
  }, [activeWorkspace, primaryPreconfigs, createSession]);

  const router = useRouter();

  const handleToggleViewMode = useCallback(() => {
    const currentPath = router.state.location.pathname;
    if (currentPath.includes('/overview')) {
      router.navigate({ to: '/server/$serverId/workspace', params: { serverId } });
    } else {
      router.navigate({ to: '/server/$serverId/overview', params: { serverId } });
    }
  }, [router, serverId]);

  const focusDock = useCallback((position: DockPosition) => {
    useDockStore.getState().setDockOpen(position, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const dock = document.querySelector<HTMLElement>(`[data-dock-position="${position}"]`);
        if (dock?.contains(document.activeElement)) return;
        const target = dock?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          ?? dock?.querySelector<HTMLElement>('[data-workspace-panel-menu]');
        target?.focus({ preventScroll: true });
      });
    });
  }, []);

  // Desktop closes the dock holding the focus; the phone leaves the focused view's surface.
  const handleCloseFocusedDock = useCallback(() => {
    const activeEl = document.activeElement;
    const views = useWorkspaceViewStore.getState();
    if (!isMobileViewport()) {
      const position = (focusedWorkspaceGroup() ?? activeEl)?.closest<HTMLElement>('[data-dock-position]')?.dataset.dockPosition;
      if (position === 'left' || position === 'right' || position === 'bottom') {
        useDockStore.getState().setDockOpen(position, false);
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[data-dock-position="center"] [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
        });
      }
      return;
    }
    const view = activeEl?.closest<HTMLElement>('[data-workspace-view]')?.dataset.workspaceView;
    if (isWorkspaceViewId(view)) views.closeView(view);
    else if (activeEl?.closest('[data-terminal-panel]')) views.closeView('terminals');
    else if (activeEl?.closest('[data-editor-surface]')) views.closeView('editor');
    else views.setMobileSurface('chat');
  }, []);

  const handleStopStreaming = useCallback(() => {
    handleInterruptSession();
  }, [handleInterruptSession]);

  const getFocusedTabs = useCallback(() => {
    // Read the rendered strip so hidden views and unavailable resources never
    // consume an index. Clicking reuses each tab's session/file activation path.
    const group = focusedWorkspaceGroup()
      ?? document.activeElement?.closest('[data-view-group], [data-mobile-tab-group]')
      ?? document.querySelector('[data-dock-position="center"] [data-view-group]')
      ?? document.querySelector('[data-mobile-tab-group]');
    return Array.from(group?.querySelectorAll<HTMLButtonElement>('[data-workspace-tab-id] > [role="tab"]') ?? [])
      .filter((tab) => !tab.closest('[inert], [hidden], [aria-hidden="true"]'));
  }, []);

  const handleFocusTab = useCallback((index: number) => {
    const tab = getFocusedTabs()[index];
    tab?.click();
    tab?.focus({ preventScroll: true });
  }, [getFocusedTabs]);

  const handleCycleTab = useCallback((direction: -1 | 1) => {
    const tabs = getFocusedTabs();
    if (tabs.length < 2) return;
    const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const target = tabs[(Math.max(0, index) + direction + tabs.length) % tabs.length];
    target.click();
    target.focus({ preventScroll: true });
  }, [getFocusedTabs]);

  const handleToggleAutoFollow = useCallback(() => {
    const focusedSessionId = useSessionBoardStore.getState().focusedSessionId;
    const focusedPane = focusedSessionId
      ? paneRegistry.getHandle(focusedSessionId)
      : undefined;

    if (focusedPane) {
      focusedPane.toggleAutoFollow();
      return;
    }

    onToggleAutoFollow?.();
  }, [onToggleAutoFollow, paneRegistry]);

  // Dock/taskbar shortcuts ("New session", "Overview") run once the shell can
  // act on them; a cold launch waits for the connection and workspace data.
  const connected = useConnectionStore((s) => s.connected);
  useEffect(() => {
    const run = () => {
      const action = takeLaunchAction((candidate) => connected && (candidate !== 'new-session'
        || (!!activeWorkspace && !!getWorkspaceDefaultPreconfigId(activeWorkspace, primaryPreconfigs))));
      if (action === 'new-session') handleNewSession();
      else if (action === 'overview') void router.navigate({ to: '/server/$serverId/overview', params: { serverId } });
    };
    run();
    return subscribeLaunchActions(run);
  }, [connected, activeWorkspace, primaryPreconfigs, handleNewSession, router, serverId]);

  // Desktop focuses the dock's selected tab; the phone shows the region's surface and focuses its content.
  const focusRegion = useCallback((position: DockPosition) => {
    if (!isMobileViewport()) { focusDock(position); return; }
    if (position === 'left') focusSidebarSessionPanelRef.current();
    else if (position === 'bottom') focusTerminalPanelRef.current();
    else focusFilesPanelRef.current();
  }, [focusDock]);

  useKeyboardShortcuts({
    onFocusLeftDock: () => focusRegion('left'),
    onFocusBottomDock: () => focusRegion('bottom'),
    onFocusRightDock: () => focusRegion('right'),
    onNewSession: handleNewSession,
    onToggleViewMode: handleToggleViewMode,
    onCloseFocusedDock: handleCloseFocusedDock,
    onFocusChatInput: focusChatInput,
    onStopStreaming: handleStopStreaming,
    onToggleAutoFollow: handleToggleAutoFollow,
    onFocusTab: handleFocusTab,
    onCycleTab: handleCycleTab,
    onCycleTerminal: (direction) => terminalPanelRef.current?.cycleTab(direction),
    onNewTerminal: () => terminalPanelRef.current?.newTerminal(),
    onCloseTerminal: () => terminalPanelRef.current?.closeActiveTerminal(),
  });
}

export interface AppKeyboardHandlersMountProps {
  sidebarRef: React.RefObject<AppSidebarHandle | null>;
  terminalPanelRef: React.RefObject<TerminalPanelHandle | null>;
  filesPanelRef: React.RefObject<{ focus: () => void } | null>;
  chatInputRef: React.RefObject<{ focus: () => void } | null>;
  handleInterruptSession: () => void;
  serverId: string;
  createSession: (preconfigId?: string, title?: string) => void;
  onToggleAutoFollow?: () => void;
}

export function AppKeyboardHandlersMount(props: AppKeyboardHandlersMountProps) {
  const activeWorkspace = useServerDataStore(selectActiveWorkspace);
  const preconfigs = useServerDataStore((s) => s.preconfigs);
  const primaryPreconfigs = preconfigs.filter((p) => p.mode !== 'subagent');

  useAppKeyboardHandlers({ ...props, activeWorkspace, primaryPreconfigs });

  return null;
}
