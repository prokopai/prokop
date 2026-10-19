import { useMemo, useRef, useState, useEffect } from 'react';
import { useParams, useRouter, Outlet } from '@tanstack/react-router';
import { useServerContext } from '@/contexts/ServerContext';
import { ViewRefsContext } from '@/contexts/ViewRefsContext';
import { SessionManagerContext, type SessionManagerValue } from '@/contexts/SessionManagerContext';
import { ServerClientProvider, useServerClientMemo } from '@/contexts/ServerClientContext';
import { SessionCommandsProvider, type SessionCommandsValue } from '@/contexts/SessionCommandsContext';
import {
  SessionPaneRegistryContext,
  type SessionPaneHandle,
  type SessionPaneRegistry,
} from '@/contexts/SessionPaneRegistryContext';
import { useServerSessionManager } from '@/hooks/useServerSessionManager';

import { AppHeader } from '@/components/app/AppHeader';
import { AppFrameSkeleton } from './AppFrameSkeleton';
import { WindowTitle } from './WindowTitle';
import { UnreadTracker } from './UnreadTracker';
import { OfflineState } from '@/components/shared/OfflineState';
import { Button } from '@/components/ui/button';
import { AppKeyboardHandlersMount } from '@/hooks/useAppKeyboardHandlers';
import type { FilesPanelHandle } from '@/components/layout/FilesPanel';
import type { MessageInputHandle } from '@/components/chat/MessageInput';
import type { TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import type { AppSidebarHandle } from '@/components/layout/AppSidebar';
import { ServerDialogs } from './ServerDialogs';
import { ReconnectStatus } from './ReconnectStatus';

/**
 * Every command the stable context delegates to the live manager. The type
 * check fails when SessionCommandsValue gains or loses a command, so the
 * delegation can never drift from the interface.
 */
const SESSION_COMMANDS = {
  createSession: true, resumeSession: true, openAlongside: true, closeSession: true, reopenSession: true,
  permanentlyDeleteSession: true, handleRenameSession: true, regenerateSessionTitle: true, revertSession: true,
  forkSession: true, editMessage: true, compactSession: true, removeFromQueue: true, steerQueued: true,
  sendChatMessage: true, sendChatMessageForSession: true, handleAskResponse: true, handleInterruptSession: true,
  handleInterruptSessionById: true, updateSessionPreconfig: true, updateSessionPreconfigForSession: true,
  updateSessionModel: true, updateSessionModelForSession: true, updateSessionVariant: true,
  updateSessionVariantForSession: true, handleNavigateBack: true, selectWorkspace: true, renameWorkspace: true,
  updateWorkspacePath: true, updateWorkspacePaths: true, updateWorkspaceSettings: true,
  handleCreateVirtualWorkspace: true, handleCreatePhysicalWorkspace: true, deleteWorkspace: true,
  createSessionInWorkspace: true, claimControl: true, handleLogout: true, handleRetry: true,
  refreshPermissions: true, revokePermission: true, revokeAllPermissions: true,
} satisfies Record<keyof SessionCommandsValue, true>;

export default function ServerShell() {
  const router = useRouter();
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params.serverId;

  const {
    servers,
    removeFromQuickConnectionsByWorkspace,
    quickConnections,
  } = useServerContext();

  const activeServer = servers.find(s => s.id === serverId) ?? null;

  const sessionManager = useServerSessionManager({
    serverId,
    activeServer,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate: (opts: { to: string; params?: Record<string, string>; search?: Record<string, unknown> }) => router.navigate({ to: opts.to as any, params: opts.params as any, search: opts.search as any }),
    removeFromQuickConnectionsByWorkspace,
    quickConnections,
  });
  const [hasConnectedOnce, setHasConnectedOnce] = useState(
    sessionManager.connected,
  );
  useEffect(() => {
    if (sessionManager.connected) setHasConnectedOnce(true);
  }, [sessionManager.connected]);

  const chatInputRef = useRef<MessageInputHandle>(null);
  const terminalPanelRef = useRef<TerminalPanelHandle>(null);
  const filesPanelRef = useRef<FilesPanelHandle>(null);
  const sidebarRef = useRef<AppSidebarHandle>(null);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const autoFollowToggleRef = useRef<{ toggle: () => void } | null>(null);
  const [paneHandles] = useState<Map<string, SessionPaneHandle>>(() => new Map());
  const paneRegistry = useMemo<SessionPaneRegistry>(() => ({
    panes: paneHandles,
    register: (sessionId, handle) => { paneHandles.set(sessionId, handle); },
    unregister: (sessionId) => { paneHandles.delete(sessionId); },
    getHandle: (sessionId) => paneHandles.get(sessionId),
  }), [paneHandles]);

  const viewRefs = useMemo(() => ({
    sidebarRef,
    chatInputRef,
    terminalPanelRef,
    filesPanelRef,
    scrollToBottomRef,
    autoFollowToggleRef,
  }), []);

  const serverClientValue = useServerClientMemo(
    sessionManager.sdkClient,
    sessionManager.serverUrl,
    sessionManager.apiToken,
    sessionManager.connected,
  );

  // Commands context holds action functions only. The manager object and its
  // functions get new identities on every store change; delegating through a ref
  // keeps the context value stable so command consumers (SessionPane, headers,
  // inputs) never re-render from reactive session state changes.
  const sessionManagerRef = useRef(sessionManager);
  useEffect(() => {
    sessionManagerRef.current = sessionManager;
  });
  const commandsValue = useMemo(() => {
    const entries = (Object.keys(SESSION_COMMANDS) as (keyof SessionCommandsValue)[]).map((key) => [
      key,
      (...args: unknown[]) => (sessionManagerRef.current[key] as (...params: unknown[]) => unknown)(...args),
    ]);
    return Object.fromEntries(entries) as SessionCommandsValue;
  }, []);

  // The manager context carries the stable commands plus the few values its
  // consumers read. Passing the manager object itself re-rendered the whole
  // workspace (sidebar, every pane header) on any session, ask, or usage change.
  const { sdkClient, serverUrl, primaryPreconfigs, isCreatingWorkspace, deletingWorkspaceId, isUpdatingWorkspace } = sessionManager;
  const managerValue = useMemo<SessionManagerValue>(() => ({
    ...commandsValue,
    sdkClient,
    serverUrl,
    primaryPreconfigs,
    isCreatingWorkspace,
    deletingWorkspaceId,
    isUpdatingWorkspace,
  }), [commandsValue, sdkClient, serverUrl, primaryPreconfigs, isCreatingWorkspace, deletingWorkspaceId, isUpdatingWorkspace]);

  if (!hasConnectedOnce) {
    if (sessionManager.connectionTimedOut || sessionManager.retryCount > 0 || sessionManager.authError) {
      return (
        <AppFrameSkeleton>
          <OfflineState
            serverUrl={sessionManager.serverUrl ?? ''}
            authError={sessionManager.authError}
            retryCount={sessionManager.retryCount}
            nextRetryIn={sessionManager.nextRetryIn}
            onRetry={sessionManager.handleRetry}
            onLogout={sessionManager.handleLogout}
          />
        </AppFrameSkeleton>
      );
    }

    return (
      <AppFrameSkeleton status="Connecting to server…">
        <Button
          variant="ghost"
          onClick={sessionManager.handleLogout}
          className="text-muted-foreground"
        >
          Change server
        </Button>
      </AppFrameSkeleton>
    );
  }

  return (
    <SessionPaneRegistryContext.Provider value={paneRegistry}>
      <ServerClientProvider value={serverClientValue}>
        <div className="app-field flex h-full w-full flex-col overflow-hidden">
          <div className="relative">
            <AppHeader />
            {!sessionManager.connected && (
              <ReconnectStatus
                key={serverId}
                authError={sessionManager.authError}
                nextRetryIn={sessionManager.nextRetryIn}
                onRetry={sessionManager.handleRetry}
              />
            )}
          </div>

          <SessionManagerContext.Provider value={managerValue}>
            <div className="flex flex-1 min-h-0 p-0">
              <SessionCommandsProvider value={commandsValue}>
                <ViewRefsContext.Provider value={viewRefs}>
                  <Outlet />
                </ViewRefsContext.Provider>
              </SessionCommandsProvider>
            </div>

            <WindowTitle />
            <UnreadTracker />
            <AppKeyboardHandlersMount
            sidebarRef={sidebarRef}
            terminalPanelRef={terminalPanelRef}
            filesPanelRef={filesPanelRef}
            chatInputRef={chatInputRef}
            handleInterruptSession={sessionManager.handleInterruptSession}
            serverId={serverId}
            createSession={sessionManager.createSession}
            onToggleAutoFollow={() => autoFollowToggleRef.current?.toggle()}
          />

          <ServerDialogs sdkClient={sessionManager.sdkClient} />
          </SessionManagerContext.Provider>
        </div>
      </ServerClientProvider>
    </SessionPaneRegistryContext.Provider>
  );
}
