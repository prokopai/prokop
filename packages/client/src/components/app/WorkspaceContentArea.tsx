import { Suspense, lazy, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useWorkspaceSessionTabs } from '@/hooks/useWorkspaceSessionTabs';
import type { FileEditorSurfaceHandle } from '@/components/editor/FileEditorSurface';
import { WorkspaceViews } from '@/components/app/WorkspaceViews';
import { WorkspaceUsageView } from '@/components/app/WorkspaceUsageView';
import { FilesPanel } from '@/components/layout/FilesPanel';
import { WorktreesPanel } from '@/components/worktrees/WorktreesPanel';
import { useViewRefs } from '@/contexts/ViewRefsContext';
import { useServerDataStore, selectActiveWorkspace } from '@/stores/serverDataStore';
import { isDocDirty, useFileEditorStore } from '@/stores/fileEditorStore';
import { fileViewId, isPullRequestsViewId, parsePullRequestsViewId, settingsViewId, useWorkspaceViewStore, type WorkspaceViewId } from '@/stores/workspaceViewStore';
import { SessionManagerContext } from '@/contexts/SessionManagerContext';
import { useShallow } from 'zustand/react/shallow';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';

// Editor (Pierre editor) and pull requests (markdown, katex) load only once
// a file or pull request tab exists.
const FileEditorSurface = lazy(() =>
  import('@/components/editor/FileEditorSurface').then((m) => ({ default: m.FileEditorSurface })),
);
const PullRequestsView = lazy(() =>
  import('@/components/pullRequests/PullRequestsView').then((m) => ({ default: m.PullRequestsView })),
);
const SettingsView = lazy(() =>
  import('@/components/views/SettingsView').then((m) => ({ default: m.SettingsView })),
);

interface WorkspaceContentAreaProps {
  sdkClient: ProkopaiClient | null;
  serverUrl: string | null;
  sessionsContent?: ReactNode;
  sessionsHeader?: ReactNode;
  left?: ReactNode;
  bottom?: ReactNode;
}

/** Resource content stays mounted while the workspace changes its placement. */
export function WorkspaceContentArea({
  sdkClient, serverUrl, sessionsContent, sessionsHeader, left, bottom,
}: WorkspaceContentAreaProps) {
  const params = useParams({
    from: '/server/$serverId', strict: false,
  } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const sessionManager = useContext(SessionManagerContext);
  const activeWorkspace = useServerDataStore(selectActiveWorkspace);
  const workspaceId = activeWorkspace?.id;
  const workspaces = useServerDataStore((state) => state.workspaces);
  const agents = useServerDataStore((state) => state.agents);
  const sessionTabs = useWorkspaceSessionTabs(serverId, sdkClient, serverUrl);
  const { filesPanelRef } = useViewRefs();
  const anyDirty = useFileEditorStore((state) => state.anyDirty);
  const docs = useFileEditorStore((state) => state.docs);
  const openDocIds = useFileEditorStore((state) => state.openDocIds);
  const activeDocId = useFileEditorStore((state) => state.activeDocId);
  const editorHandles = useRef(new Map<string, FileEditorSurfaceHandle>());
  const scopedDocIds = openDocIds.filter((id) => {
    const identity = docs[id]?.identity;
    return identity?.serverId === serverId;
  });
  const nameCounts = new Map<string, number>();
  for (const id of scopedDocIds) nameCounts.set(docs[id].name, (nameCounts.get(docs[id].name) ?? 0) + 1);
  const resourceViews: Partial<Record<WorkspaceViewId, ReactNode>> = { ...sessionTabs.views };
  const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = { ...sessionTabs.tabs };
  for (const docId of scopedDocIds) {
    const doc = docs[docId];
    const viewId = fileViewId(docId);
    const workspace = workspaces.find((item) => item.id === doc.identity.workspaceId)
      ?? (activeWorkspace?.id === doc.identity.workspaceId ? activeWorkspace : undefined);
    const projectName = (workspace ? getWorkspaceDisplayName(workspace, agents) : undefined) || 'Unknown project';
    const checkout = doc.identity.root || workspace?.path || 'Main checkout';
    const context = `${projectName} · ${checkout} · ${doc.identity.path}`;
    resourceViews[viewId] = (
      <Suspense fallback={null}>
        <FileEditorSurface
          ref={(handle) => {
            if (handle) editorHandles.current.set(docId, handle);
            else editorHandles.current.delete(docId);
          }}
          sdkClient={sdkClient} serverId={doc.identity.serverId}
          workspaceId={doc.identity.workspaceId} documentId={docId} documentContext={context}
        />
      </Suspense>
    );
    tabs[viewId] = {
      label: (nameCounts.get(doc.name) ?? 0) > 1 ? `${doc.name} · ${context}` : doc.name,
      description: context,
      dirty: isDocDirty(doc),
      closeDisabled: doc.status === 'saving',
      onActivate: () => useFileEditorStore.getState().setActiveDoc(docId),
      onClose: () => editorHandles.current.get(docId)?.requestClose(),
    };
  }
  // One tab per workspace, like files: each keeps its own workspace whatever is active.
  const pullRequestIds = useWorkspaceViewStore(useShallow((state) => Object.values(state.layout.groups)
    .flatMap((group) => group.viewIds).filter(isPullRequestsViewId)));
  for (const viewId of pullRequestIds) {
    const target = parsePullRequestsViewId(viewId);
    const workspace = target && target.serverId === serverId ? workspaces.find((item) => item.id === target.workspaceId) : undefined;
    if (!workspace || !serverId || !sdkClient) continue;
    const name = getWorkspaceDisplayName(workspace, agents) || 'Workspace';
    resourceViews[viewId] = (
      <Suspense key={viewId} fallback={null}>
        <PullRequestsView client={sdkClient} serverId={serverId} workspaceId={workspace.id} />
      </Suspense>
    );
    tabs[viewId] = {
      label: `Pull requests · ${name}`,
      description: workspace.path,
      onClose: () => useWorkspaceViewStore.getState().removeView(viewId),
    };
  }
  // Settings is one tab per server, like a pull requests tab without a workspace.
  const settingsId = serverId ? settingsViewId(serverId) : null;
  const settingsOpen = useWorkspaceViewStore((state) => settingsId !== null
    && Object.values(state.layout.groups).some((group) => group.viewIds.includes(settingsId)));
  if (settingsId && settingsOpen && serverId) {
    resourceViews[settingsId] = (
      <Suspense key={settingsId} fallback={null}>
        <SettingsView sdkClient={sdkClient} serverId={serverId} onLogout={sessionManager?.handleLogout ?? (() => {})} />
      </Suspense>
    );
    tabs[settingsId] = {
      label: 'Settings',
      onClose: () => useWorkspaceViewStore.getState().removeView(settingsId),
    };
  }
  const mobileEditorId = activeDocId && scopedDocIds.includes(activeDocId)
    ? fileViewId(activeDocId) : scopedDocIds[0] ? fileViewId(scopedDocIds[0]) : undefined;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!anyDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  return (
    <WorkspaceViews tabs={tabs} mobileEditorId={mobileEditorId} mobileSessionId={sessionTabs.mobileSessionId} views={{
      ...resourceViews,
      sessions: left ?? (sessionsContent ? <>{sessionsHeader}{sessionsContent}</> : undefined),
      usage: <WorkspaceUsageView sdkClient={sdkClient} />,
      explorer: serverId && workspaceId ? <FilesPanel ref={filesPanelRef} sdkClient={sdkClient} view="explorer" /> : undefined,
      changes: serverId && workspaceId ? <FilesPanel sdkClient={sdkClient} view="changes" /> : undefined,
      branches: serverId && workspaceId ? <FilesPanel sdkClient={sdkClient} view="branches" /> : undefined,
      worktrees: serverId && workspaceId ? <WorktreesPanel sdkClient={sdkClient} workspaceId={workspaceId} /> : undefined,
      terminals: bottom,
    }} />
  );
}
