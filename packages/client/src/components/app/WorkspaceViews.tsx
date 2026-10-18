import { cn } from '@/lib/utils';
import { dockHeaderClassName } from '@/components/ui/dock-header';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { WorkspaceDock } from '@/components/app/WorkspaceDock';
import { WorkspaceSplitTree } from '@/components/app/WorkspaceSplitTree';
import { filterTree, treeGroups, type ViewTree } from '@/stores/workspaceSplitLayout';
import { WorkspaceTabStrip, workspaceTabLabel } from '@/components/app/WorkspaceTabStrip';
import { WorkspaceTabSearch } from '@/components/app/WorkspaceTabSearch';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { WorkspaceViewHost } from '@/components/app/WorkspaceViewHost';
import { DockRegion } from '@/components/layout/DockRegion';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useScopedSessionFiles } from '@/stores/sessionFilesStore';
import { useDockStore } from '@/stores/dockStore';
import {
  activeGroupView, findViewGroup, findViewRegion, isFileViewId, isPullRequestsViewId, isRepositoryViewId, isSessionViewId, REPOSITORY_VIEW_IDS, resolveViewLayout, useWorkspaceViewStore,
  type ViewRegion, type WorkspaceViewId,
} from '@/stores/workspaceViewStore';

interface WorkspaceViewsProps {
  views: Partial<Record<WorkspaceViewId, ReactNode>>;
  tabs?: Partial<Record<WorkspaceViewId, WorkspaceTab>>;
  mobileEditorId?: WorkspaceViewId;
  mobileSessionId?: WorkspaceViewId;
}

export function WorkspaceViews({ views, tabs = {}, mobileEditorId, mobileSessionId }: WorkspaceViewsProps) {
  const isMobile = useIsMobile();
  const storedLayout = useWorkspaceViewStore((state) => state.layout);
  const mobileTerminalOpen = useWorkspaceViewStore((state) => state.mobileTerminalOpen);
  const docks = useDockStore((state) => state.docks);
  const mobileSurface = useWorkspaceViewStore((state) => state.mobileSurface);
  const setMobileSurface = useWorkspaceViewStore((state) => state.setMobileSurface);
  const repositoryView = useScopedSessionFiles((state) => state.filesPanelTab);
  const setRepositoryView = useScopedSessionFiles((state) => state.setFilesPanelTab);
  const [centerSlot, attachCenter] = useState<HTMLDivElement | null>(null);
  const [slots, setSlots] = useState<Record<string, HTMLDivElement | null>>({});
  const attachSlot = useCallback((id: string, slot: HTMLDivElement | null) => {
    setSlots((previous) => {
      if ((previous[id] ?? null) === slot) return previous;
      const next = { ...previous };
      if (slot) next[id] = slot;
      else delete next[id];
      return next;
    });
  }, []);
  const available = (Object.keys(views) as WorkspaceViewId[]).filter((id) => views[id] != null);
  const layout = resolveViewLayout(storedLayout, available);
  const fileIds = available.filter(isFileViewId);
  const sessionIds = available.filter(isSessionViewId);
  const selectedSession = mobileSessionId && available.includes(mobileSessionId) ? mobileSessionId : sessionIds[0];
  const hasEditor = fileIds.length > 0 || available.includes('editor');
  const selectedFile = mobileEditorId && fileIds.includes(mobileEditorId as `file:${string}`) ? mobileEditorId : fileIds[0];
  const selectFile = (id: WorkspaceViewId) => {
    useWorkspaceViewStore.getState().activateView(id);
    tabs[id]?.onActivate?.();
  };
  const repositoryIds = REPOSITORY_VIEW_IDS.filter((id) => available.includes(id));
  const chatView = selectedSession ?? 'conversations';
  // Several pull requests tabs can be open (one per workspace); show the one last activated.
  const pullRequestIds = available.filter(isPullRequestsViewId);
  const pullRequestsView = pullRequestIds.find((id) => layout.groups[findViewGroup(layout, id)]?.activeId === id) ?? pullRequestIds.at(-1);
  const requestedMobileView: WorkspaceViewId = mobileSurface === 'chat' ? chatView : mobileSurface === 'files' ? repositoryView
    : mobileSurface === 'pull-requests' ? pullRequestsView ?? chatView : mobileSurface;
  const mobileView = requestedMobileView === 'editor' && hasEditor ? 'editor' : available.includes(requestedMobileView) ? requestedMobileView
    : (requestedMobileView === 'editor' || mobileSurface === 'files') && available.includes('explorer') ? 'explorer' : chatView;
  const isRepositoryView = repositoryIds.some((id) => id === mobileView);

  const group = (region: ViewRegion) => {
    const tree: ViewTree = filterTree(layout.roots[region], (id) => !!activeGroupView(layout, id, available))
      ?? { kind: 'group', groupId: treeGroups(layout.roots[region])[0] };
    return <WorkspaceSplitTree tree={tree} region={region} available={available} tabs={tabs} onSlot={attachSlot} />;
  };
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {isMobile ? (
        <div data-mobile-tab-group className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {mobileView !== chatView && (
            <div className={cn(dockHeaderClassName(), "bg-sidebar px-1")}>
              <Button variant="ghost" size="icon-sm" aria-label="Back to Chat" onClick={() => setMobileSurface('chat')}><ArrowLeft className="size-4" /></Button>
              <span className="text-sm">{workspaceTabLabel(mobileView, tabs)}</span>
              {(isRepositoryView || mobileView === 'editor') && hasEditor && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setMobileSurface(isRepositoryView ? 'editor' : 'files')}>
                  {isRepositoryView ? 'Editor' : 'Files'}
                </Button>
              )}
            </div>
          )}
          {mobileView === chatView && sessionIds.length > 0 && (
            <div className={cn(dockHeaderClassName(true), "px-1")}>
              <WorkspaceTabStrip ids={sessionIds} activeId={selectedSession ?? null} tabs={tabs} label="Open sessions"
                onSelect={selectFile} onClose={(id) => tabs[id]?.onClose?.()} />
              <WorkspaceTabSearch ids={sessionIds} tabs={tabs} onSelect={selectFile} />
            </div>
          )}
          {isRepositoryView && (
            <div className={cn(dockHeaderClassName(true), "px-1")}>
              <WorkspaceTabStrip ids={repositoryIds} activeId={mobileView} tabs={tabs} label="Repository views"
                onSelect={(id) => { if (isRepositoryViewId(id)) setRepositoryView(id); }} onClose={() => {}} />
            </div>
          )}
          {mobileView === 'editor' && fileIds.length > 0 && (
            <div className={cn(dockHeaderClassName(true), "px-1")}>
              <WorkspaceTabStrip ids={fileIds} activeId={selectedFile ?? null} tabs={tabs} label="Open files"
                onSelect={selectFile} onClose={(id) => {
                  if (tabs[id]?.closeDisabled) return;
                  if (tabs[id]?.dirty) selectFile(id);
                  tabs[id]?.onClose?.();
                }} />
              <WorkspaceTabSearch ids={fileIds} tabs={tabs} onSelect={selectFile} />
            </div>
          )}
          <div ref={attachCenter} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {mobileView === chatView && !selectedSession && !available.includes('conversations') && <WorkspaceEmptyState />}
          </div>
        </div>
      ) : (
        <WorkspaceDock
          left={<DockRegion position="left">{group('left')}</DockRegion>}
          center={<div data-dock-position="center" className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border">{group('center')}</div>}
          right={<DockRegion position="right">{group('right')}</DockRegion>}
          bottom={<DockRegion position="bottom">{group('bottom')}</DockRegion>}
        />
      )}
      {available.map((id) => {
        const region = findViewRegion(layout, id);
        const groupId = findViewGroup(layout, id);
        const visible = isMobile
          ? id === 'terminals' ? mobileTerminalOpen : isFileViewId(id) ? mobileView === 'editor' && id === selectedFile : id === mobileView
          : activeGroupView(layout, groupId, available) === id && (region === 'center' || docks[region].open);
        return (
          <WorkspaceViewHost key={id} id={id} label={workspaceTabLabel(id, tabs)} target={isMobile ? centerSlot : slots[groupId] ?? null} visible={visible}>
            {views[id]}
          </WorkspaceViewHost>
        );
      })}
    </div>
  );
}

function WorkspaceEmptyState() {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
    <p>Select or create a session</p>
    <p className="text-sm">Choose a session from Sessions, or add a view to this dock.</p>
  </div>;
}
