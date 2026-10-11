import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { Plus, Folder, Terminal as TerminalIcon } from 'lucide-react';
import { TerminalView } from './TerminalView';
import { TerminalAddToChat } from './TerminalAddToChat';
import { TerminalTabStrip, type TerminalTab } from './TerminalTabStrip';
import {
  useTerminalConnection,
  createTerminalInstance,
  createTerminalCache,
  type CachedTerminal,
  type TerminalStatus,
  type SessionInitData,
  type TerminalCache,
} from '@/hooks/useTerminal';
import type { TerminalEvent } from '@prokopai/sdk';
import type { TerminalEventsConnection } from '@prokopai/sdk';
import { useIsMobile } from '@/hooks/use-mobile';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ProkopaiClient } from '@prokopai/sdk';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useWorktreesQuery } from '@/hooks/queries';

export interface TerminalPanelHandle {
  focus: () => void;
  /** Opens the previous or next terminal tab and focuses its shell. */
  cycleTab: (direction: -1 | 1) => void;
  /** Opens a terminal in the active tab's folder (or the default root). */
  newTerminal: () => void;
  closeActiveTerminal: () => void;
}

interface TerminalPanelProps {
  workspaceId: string | undefined;
  workspacePath: string | undefined;
  workspaceName: string | undefined;
  additionalPaths: string[];
  sdkClient: ProkopaiClient | null;
  isOpen: boolean;
  keepAlive?: boolean;
  onClose: () => void;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({
  workspaceId,
  workspacePath,
  workspaceName,
  additionalPaths,
  sdkClient,
  isOpen,
  keepAlive = false,
  onClose,
}, ref) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [lifetime, setLifetime] = useState({ workspaceId, sdkClient, started: isOpen });
  if (lifetime.workspaceId !== workspaceId || lifetime.sdkClient !== sdkClient) {
    setLifetime({ workspaceId, sdkClient, started: isOpen });
  } else if (isOpen && !lifetime.started) {
    setLifetime({ ...lifetime, started: true });
  }
  const enabled = isOpen || (keepAlive && lifetime.workspaceId === workspaceId && lifetime.sdkClient === sdkClient && lifetime.started);
  const isMobile = useIsMobile();
  const viewport = useVisualViewport();
  const connected = useConnectionStore((state) => state.connected);
  const focusedSessionId = useSessionBoardStore((state) => state.focusedSessionId);
  const focusedSession = useSessionStore((state) => (
    state.sessions.find((session) => session.id === focusedSessionId) ?? null
  ));
  const worktrees = useWorktreesQuery(sdkClient, workspaceId);
  const sessionWorktree = worktrees.data?.find((worktree) => (
    worktree.id === focusedSession?.workspaceRootId
  )) ?? focusedSession?.worktree;
  const defaultTerminalRoot = focusedSession?.workspaceRootId
    ? sessionWorktree?.state === 'available' ? sessionWorktree.path : undefined
    : workspacePath;

  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabServerId, setActiveTabServerId] = useState<string | null>(null);
  const [connectionTarget, setConnectionTarget] = useState<CachedTerminal | null>(null);
  const reconnectAttemptRef = useRef(0);

  const terminalCacheRef = useRef<TerminalCache>(createTerminalCache());
  const activeConnectionRef = useRef<{
    serverSessionId: string;
    disconnect: () => void;
    destroy: () => void;
  } | null>(null);
  const eventsConnRef = useRef<TerminalEventsConnection | null>(null);
  const tabsRef = useRef<TerminalTab[]>([]);
  const handleTerminalEventRef = useRef<(event: TerminalEvent) => void>(() => {});
  const autoCreateRef = useRef(false);
  const autoCreateResetRef = useRef<string | undefined>(undefined);
  const activeTabByWorkspaceRef = useRef<Map<string, string>>(new Map());
  const addTabRef = useRef<() => void>(() => {});

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const handleTerminalEvent = useCallback((event: TerminalEvent) => {
    switch (event.type) {
      case 'snapshot': {
        setTabs(prev => event.sessions.map(s => {
          const existing = prev.find(tab => tab.serverSessionId === s.id);
          return {
            serverSessionId: s.id,
            title: s.title,
            status: s.status === 'exited' ? 'exited' : existing?.status ?? 'disconnected',
            cwd: s.cwd,
            shell: s.shell,
            origin: s.origin ?? 'user',
            ownerSessionId: s.ownerSessionId,
          };
        }));

        if (event.sessions.length > 0) {
          const rememberedId = workspaceId
            ? activeTabByWorkspaceRef.current.get(workspaceId)
            : undefined;
          setActiveTabServerId(prev => {
            let selectedId = event.sessions[0].id;
            if (rememberedId && event.sessions.some(s => s.id === rememberedId)) {
              selectedId = rememberedId;
            } else if (prev && event.sessions.some(s => s.id === prev)) {
              selectedId = prev;
            }
            if (workspaceId) {
              activeTabByWorkspaceRef.current.set(workspaceId, selectedId);
            }
            return selectedId;
          });
        } else {
          if (workspaceId) {
            activeTabByWorkspaceRef.current.delete(workspaceId);
          }
          setActiveTabServerId(null);
          if (!autoCreateRef.current) {
            autoCreateRef.current = true;
            addTabRef.current();
          }
        }

        break;
      }
      case 'created': {
        setTabs(prev => {
          if (prev.some(t => t.serverSessionId === event.session.id)) {
            return prev;
          }
          return [...prev, {
            serverSessionId: event.session.id,
            title: event.session.title,
            status: 'disconnected',
            cwd: event.session.cwd,
            shell: event.session.shell,
            origin: event.session.origin ?? 'user',
            ownerSessionId: event.session.ownerSessionId,
          }];
        });
        // Terminals the agent opens appear as tabs without taking over the
        // one you are using.
        if (event.session.origin === 'agent' && tabsRef.current.length > 0) break;
        if (workspaceId) {
          activeTabByWorkspaceRef.current.set(workspaceId, event.session.id);
        }
        setActiveTabServerId(event.session.id);
        break;
      }
      case 'destroyed': {
        setTabs(prev => prev.filter(t => t.serverSessionId !== event.sessionId));
        terminalCacheRef.current.dispose(event.sessionId);
        setActiveTabServerId(prev => {
          if (prev !== event.sessionId) return prev;
          const remaining = tabsRef.current.filter(t => t.serverSessionId !== event.sessionId);
          const nextId = remaining.length > 0 ? remaining[0].serverSessionId : null;
          if (workspaceId) {
            if (nextId) {
              activeTabByWorkspaceRef.current.set(workspaceId, nextId);
            } else {
              activeTabByWorkspaceRef.current.delete(workspaceId);
            }
          }
          return nextId;
        });
        break;
      }
      case 'exited': {
        setTabs(prev => prev.map(t =>
          t.serverSessionId === event.sessionId
            ? { ...t, status: 'exited' }
            : t
        ));
        break;
      }
      case 'title_changed': {
        setTabs(prev => prev.map(t =>
          t.serverSessionId === event.sessionId
            ? { ...t, title: event.title }
            : t
        ));
        break;
      }
      case 'status_changed': {
        if (event.status === 'exited') {
          setTabs(prev => prev.map(t =>
            t.serverSessionId === event.sessionId
              ? { ...t, status: 'exited' }
              : t
          ));
        }
        break;
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    handleTerminalEventRef.current = handleTerminalEvent;
  }, [handleTerminalEvent]);

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setTabs([]);
      setActiveTabServerId(null);
      autoCreateRef.current = false;
      terminalCacheRef.current.disposeAll();
    }

    if (!workspaceId || !enabled || !sdkClient || !connected) {
      if (activeConnectionRef.current) {
        activeConnectionRef.current.disconnect();
        activeConnectionRef.current = null;
      }
      setConnectionTarget(null);

      if (eventsConnRef.current) {
        eventsConnRef.current.dispose();
        eventsConnRef.current = null;
      }
      return;
    }

    const terminalClient = sdkClient;
    const terminalWorkspaceId = workspaceId;
    let cancelled = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let currentConn: TerminalEventsConnection | null = null;
    if (activeConnectionRef.current) {
      activeConnectionRef.current.disconnect();
      activeConnectionRef.current = null;
    }
    setConnectionTarget(null);
    terminalCacheRef.current.disposeAll();

    const scheduleRetry = (error: Error) => {
      if (cancelled || retryTimer) return;
      console.error('[TerminalPanel] Terminal events connection failed:', error.message);

      const delay = Math.min(1000 * 2 ** retryAttempt, 10000);
      retryAttempt++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        subscribe();
      }, delay);

      const conn = currentConn;
      currentConn = null;
      if (eventsConnRef.current === conn) {
        eventsConnRef.current = null;
      }
      conn?.dispose();
    };

    function subscribe() {
      terminalClient.terminal.subscribeEvents(terminalWorkspaceId).then(({ conn, initialSessions }) => {
        if (cancelled) {
          conn.dispose();
          return;
        }

        retryAttempt = 0;
        currentConn = conn;
        eventsConnRef.current = conn;
        handleTerminalEventRef.current({ type: 'snapshot', sessions: initialSessions });

        conn.on('snapshot', (sessions) => {
          handleTerminalEventRef.current({ type: 'snapshot', sessions });
        });
        conn.on('created', (session) => {
          handleTerminalEventRef.current({ type: 'created', session });
        });
        conn.on('destroyed', (sessionId) => {
          handleTerminalEventRef.current({ type: 'destroyed', sessionId });
        });
        conn.on('exited', (sessionId, exitCode) => {
          handleTerminalEventRef.current({ type: 'exited', sessionId, exitCode });
        });
        conn.on('title_changed', (sessionId, title) => {
          handleTerminalEventRef.current({ type: 'title_changed', sessionId, title });
        });
        conn.on('status_changed', (sessionId, status) => {
          handleTerminalEventRef.current({ type: 'status_changed', sessionId, status });
        });
        conn.on('close', () => {
          scheduleRetry(new Error('Terminal events connection closed'));
        });
        conn.on('error', (error) => {
          scheduleRetry(error);
        });
      }).catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        scheduleRetry(error);
      });
    }

    subscribe();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      currentConn?.dispose();
      currentConn = null;
      eventsConnRef.current = null;
    };
  }, [workspaceId, enabled, sdkClient, connected]);

  const onOutput = useCallback((serverSessionId: string) => (data: string) => {
    const cached = terminalCacheRef.current.get(serverSessionId);
    cached?.terminal.write(data);
  }, []);

  const onStatusChange = useCallback((serverSessionId: string) => (status: TerminalStatus) => {
    if (status === 'connected') {
      reconnectAttemptRef.current = 0;
    }
    setTabs(prev => prev.map(t =>
      t.serverSessionId === serverSessionId
        ? { ...t, status }
        : t
    ));
  }, []);

  const onSessionInit = useCallback((serverSessionId: string) => (init: SessionInitData) => {
    const cached = terminalCacheRef.current.get(serverSessionId);
    if (cached) {
      cached.serverSessionId = init.sessionId;
    }
    setTabs(prev => prev.map(t =>
      t.serverSessionId === serverSessionId
        ? { ...t, title: init.title || t.title }
        : t
    ));
  }, []);

  const onTitleChange = useCallback((serverSessionId: string) => (title: string) => {
    setTabs(prev => prev.map(t =>
      t.serverSessionId === serverSessionId
        ? { ...t, title }
        : t
    ));
  }, []);

  const { connect, disconnect, destroy } = useTerminalConnection(
    connectionTarget?.terminal ?? null,
    connectionTarget && connected && sdkClient && workspaceId && workspacePath && connectionTarget.serverSessionId ? {
      terminal: connectionTarget.terminal,
      sdkClient,
      workspaceId,
      cwd: tabs.find(t => t.serverSessionId === connectionTarget.serverSessionId)?.cwd ?? workspacePath,
      serverSessionId: connectionTarget.serverSessionId,
      onOutput: onOutput(connectionTarget.serverSessionId),
      onStatusChange: onStatusChange(connectionTarget.serverSessionId),
      onSessionInit: onSessionInit(connectionTarget.serverSessionId),
      onTitleChange: onTitleChange(connectionTarget.serverSessionId),
    } : {
      terminal: null,
      sdkClient: null as unknown as import('@prokopai/sdk').ProkopaiClient,
      workspaceId: '',
      cwd: '',
      onOutput: () => {},
      onStatusChange: () => {},
    }
  );

  const attachActiveTerminal = useCallback(() => {
    if (!connected || !activeTabServerId || !sdkClient || !workspacePath) return;

    const cached = terminalCacheRef.current.get(activeTabServerId);

    let terminalEntry: CachedTerminal;
    if (cached) {
      terminalEntry = cached;
    } else {
      const { terminal, fitAddon } = createTerminalInstance();
      terminalEntry = {
        terminal,
        fitAddon,
        serverSessionId: activeTabServerId,
        status: 'connecting',
        isOpened: false,
      };
      terminalCacheRef.current.set(activeTabServerId, terminalEntry);
    }

    if (activeConnectionRef.current) {
      activeConnectionRef.current.disconnect();
      activeConnectionRef.current = null;
    }

    setConnectionTarget(terminalEntry);
  }, [connected, activeTabServerId, sdkClient, workspacePath]);

  useEffect(() => {
    if (!enabled || !activeTabServerId) return;
    attachActiveTerminal();
  }, [enabled, activeTabServerId, attachActiveTerminal]);

  useEffect(() => {
    if (connectionTarget && connectionTarget.serverSessionId) {
      activeConnectionRef.current = {
        serverSessionId: connectionTarget.serverSessionId,
        disconnect,
        destroy,
      };
      connect(connectionTarget.serverSessionId);
    }
  }, [connectionTarget, connect, disconnect, destroy]);

  const activeTabStatus = tabs.find(t => t.serverSessionId === activeTabServerId)?.status;

  useEffect(() => {
    reconnectAttemptRef.current = 0;
  }, [workspaceId, activeTabServerId]);

  useEffect(() => {
    if (
      !connected ||
      !enabled ||
      !activeTabServerId ||
      activeTabStatus !== 'disconnected' ||
      reconnectAttemptRef.current >= 5
    ) return;

    const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 10000);
    reconnectAttemptRef.current++;
    const retryTimer = setTimeout(() => {
      connect(activeTabServerId);
    }, delay);

    return () => clearTimeout(retryTimer);
  }, [workspaceId, connected, enabled, activeTabServerId, activeTabStatus, connect]);

  const selectTerminalTab = useCallback((serverSessionId: string) => {
    if (workspaceId) {
      activeTabByWorkspaceRef.current.set(workspaceId, serverSessionId);
    }
    if (connected && serverSessionId === activeTabServerId && activeTabStatus === 'disconnected') {
      reconnectAttemptRef.current = 0;
      connect(serverSessionId);
      return;
    }
    setActiveTabServerId(serverSessionId);
  }, [workspaceId, connected, activeTabServerId, activeTabStatus, connect]);

  const addTab = useCallback(async (cwd = defaultTerminalRoot) => {
    if (!workspaceId || !cwd || !sdkClient) return;

    try {
      await sdkClient.http.terminals.create(workspaceId, {
        body: {
          cwd,
          ...(cwd === sessionWorktree?.path && sessionWorktree.state === 'available'
            ? { managedWorktreeId: sessionWorktree.id }
            : {}),
        },
      });
    } catch (err) {
      console.error('[TerminalPanel] Failed to create terminal:', err);
    }
  }, [workspaceId, defaultTerminalRoot, sdkClient, sessionWorktree]);

  useEffect(() => {
    addTabRef.current = addTab;
  }, [addTab]);

  const closeTab = useCallback(async (serverSessionId: string) => {
    if (!workspaceId || !sdkClient) return;

    if (activeConnectionRef.current?.serverSessionId === serverSessionId) {
      activeConnectionRef.current.destroy();
      activeConnectionRef.current = null;
      setConnectionTarget(null);
    }

    terminalCacheRef.current.dispose(serverSessionId);

    try {
      await sdkClient.http.terminals.delete(workspaceId, serverSessionId);
    } catch (err) {
      console.error('[TerminalPanel] Failed to destroy terminal:', err);
    }
  }, [workspaceId, sdkClient]);

  useEffect(() => {
    if (autoCreateResetRef.current !== workspaceId) {
      autoCreateResetRef.current = workspaceId;
      autoCreateRef.current = false;
    }
  }, [workspaceId]);

  useEffect(() => {
    return () => {
      const cache = terminalCacheRef.current;
      cache.disposeAll();
    };
  }, []);

  const focusActiveTerminal = useCallback(() => {
    if (activeTabServerId) {
      const cached = terminalCacheRef.current.get(activeTabServerId);
      cached?.terminal.focus();
    }
  }, [activeTabServerId]);

  // Switching tabs unmounts the focused xterm, so focus would fall to the
  // page. Focus the new shell once its xterm is opened.
  const focusAfterSwitchRef = useRef(false);
  useEffect(() => {
    if (!activeTabServerId) {
      focusAfterSwitchRef.current = false;
      return;
    }
    if (!focusAfterSwitchRef.current) return;
    const cached = terminalCacheRef.current.get(activeTabServerId);
    if (!cached?.isOpened) return;
    focusAfterSwitchRef.current = false;
    if (document.activeElement?.closest('[data-terminal-rename]')) return;
    cached.terminal.focus();
  }, [activeTabServerId, connectionTarget]);

  const activateTab = useCallback((serverSessionId: string) => {
    focusAfterSwitchRef.current = true;
    selectTerminalTab(serverSessionId);
    if (serverSessionId === activeTabServerId) {
      focusAfterSwitchRef.current = false;
      focusActiveTerminal();
    }
  }, [selectTerminalTab, activeTabServerId, focusActiveTerminal]);

  const renameTab = useCallback(async (serverSessionId: string, title: string) => {
    if (!workspaceId || !sdkClient) return;
    const previous = tabsRef.current.find(t => t.serverSessionId === serverSessionId)?.title;
    setTabs(prev => prev.map(t => t.serverSessionId === serverSessionId ? { ...t, title } : t));
    try {
      await sdkClient.http.terminals.rename(workspaceId, serverSessionId, title);
    } catch (err) {
      console.error('[TerminalPanel] Failed to rename terminal:', err);
      if (previous !== undefined) {
        setTabs(prev => prev.map(t => t.serverSessionId === serverSessionId ? { ...t, title: previous } : t));
      }
    }
  }, [workspaceId, sdkClient]);

  useImperativeHandle(ref, () => ({
    focus: focusActiveTerminal,
    cycleTab: (direction) => {
      const current = tabsRef.current;
      if (current.length < 2) return;
      const index = current.findIndex(t => t.serverSessionId === activeTabServerId);
      activateTab(current[(Math.max(0, index) + direction + current.length) % current.length].serverSessionId);
    },
    newTerminal: () => {
      const activeCwd = tabsRef.current.find(t => t.serverSessionId === activeTabServerId)?.cwd;
      const roots = [
        workspacePath,
        ...additionalPaths,
        ...(worktrees.data ?? []).filter(w => w.state === 'available').map(w => w.path),
      ];
      focusAfterSwitchRef.current = true;
      void addTab(activeCwd && roots.includes(activeCwd) ? activeCwd : undefined);
    },
    closeActiveTerminal: () => {
      if (!activeTabServerId) return;
      focusAfterSwitchRef.current = true;
      void closeTab(activeTabServerId);
    },
  }), [focusActiveTerminal, activateTab, activeTabServerId, workspacePath, additionalPaths, worktrees.data, addTab, closeTab]);

  useEffect(() => {
    if (!isOpen || !activeTabServerId) return;
    const timer = setTimeout(() => {
      // A session/workspace switch can replace the terminal in an open dock.
      // Visibility alone must not reclaim focus from the user's current dock,
      // nor from a tab being renamed.
      const panel = panelRef.current;
      const owner = panel?.closest('[data-view-group]') ?? panel;
      if (document.activeElement?.closest('[data-terminal-rename]')) return;
      if (owner?.contains(document.activeElement)) focusActiveTerminal();
    }, 300);
    return () => clearTimeout(timer);
  }, [isOpen, activeTabServerId, focusActiveTerminal]);

  // Keep the controller and cached terminal alive while another view is selected.
  if (!enabled) {
    return null;
  }

  if (!workspaceId || !workspacePath) {
    return (
      <div className={cn('flex items-center justify-center bg-sidebar text-muted-foreground text-sm', isMobile ? 'h-[300px]' : 'h-full')}>
        Select a workspace to use the terminal.
      </div>
    );
  }

  const activeTab = tabs.find(t => t.serverSessionId === activeTabServerId);
  const activeCached = activeTabServerId ? terminalCacheRef.current.get(activeTabServerId) : null;

  const terminalRoots = [
    ...(sessionWorktree ? [{
      label: `${sessionWorktree.branch ?? 'Detached HEAD'} (focused session)`,
      path: sessionWorktree.path,
    }] : []),
    { label: workspaceName || workspacePath.split('/').pop() || 'Workspace', path: workspacePath },
    ...additionalPaths.map(path => ({
      label: path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path,
      path,
    })),
    ...(worktrees.data ?? [])
      .filter((worktree) => worktree.state === 'available' && worktree.id !== sessionWorktree?.id)
      .map((worktree) => ({
        label: worktree.branch ?? 'Detached HEAD',
        path: worktree.path,
      })),
  ];

  const renderAddTerminalMenu = () => {
    if (terminalRoots.length === 1) {
      return (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => addTab()}
          title="New terminal tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      );
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            title="New terminal tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56 max-w-80">
          {terminalRoots.map(root => (
            <DropdownMenuItem
              key={root.path}
              className="gap-2"
              onClick={() => addTab(root.path)}
            >
              <Folder className={cn('size-3.5 shrink-0', FOLDER_ICON_COLOR)} />
              <span className="min-w-0">
                <span className="block truncate">{root.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{root.path}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderTabs = (compact: boolean) => (
    <TerminalTabStrip
      tabs={tabs}
      activeId={activeTabServerId}
      compact={compact}
      onActivate={activateTab}
      onClose={closeTab}
      onRename={renameTab}
      trailing={renderAddTerminalMenu()}
    />
  );

  const renderTerminalContent = () => (
    <div className="flex-1 min-h-0 overflow-hidden relative">
      {activeCached && activeTab ? (
        <>
          <TerminalView
            key={activeTabServerId}
            cachedTerminal={activeCached}
            visible={isOpen}
          />
          <TerminalAddToChat
            key={`add-to-chat:${activeTabServerId}`}
            terminal={activeCached.terminal}
            label={activeTab.title || activeTab.shell.split('/').pop() || 'Terminal'}
            cwd={activeTab.cwd || undefined}
            sessionId={focusedSessionId}
          />
        </>
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No terminal sessions
        </div>
      )}
    </div>
  );

  if (isMobile) {
    const keyboardOpen = viewport.height < window.innerHeight * 0.85;
    const sheetHeight = keyboardOpen
      ? `calc(${viewport.height}px - env(safe-area-inset-top, 0px))`
      : Math.min(window.innerHeight * 0.7, viewport.height);

    // Opened from the app header toggle; dismissed by tapping outside.
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          ref={panelRef}
          data-terminal-panel=""
          side="top"
          className="p-0 bg-sidebar [&>button]:hidden flex flex-col"
          style={{ height: sheetHeight }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Terminal</SheetTitle>
          </SheetHeader>
          {renderTabs(false)}
          {renderTerminalContent()}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div ref={panelRef} data-terminal-panel="" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header with inline tabs; the panel itself toggles from the app header like the other panels */}
      <div className="flex items-center gap-1 bg-sidebar px-2 py-1 shrink-0">
        <TerminalIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        {renderTabs(true)}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
        {renderTerminalContent()}
      </div>
    </div>
  );
});
