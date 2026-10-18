import { dockHeaderClassName } from '@/components/ui/dock-header';
import { forwardRef, useCallback, useImperativeHandle, useRef, useState, useMemo } from 'react';
import { RefreshCw, ChevronDown, Folder, GitBranch, Check, PinOff, Plus, FilePlus2, FolderPlus } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import type { ProkopaiClient } from '@prokopai/sdk';
import { FileTree, type FileTreeHandle, GitChangesView, type GitChangesViewHandle } from '@/components/files';
import { type FileEntryActionTarget } from '@/components/files/fileEntry';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useGitStatusQuery } from '@/hooks/queries/useFileQueries';
import { useWorktreeMutations, useWorktreesQuery } from '@/hooks/queries';
import { summarizeDiffStats } from '@/components/files/GitChangesView';
import { cn } from '@/lib/utils';
import { useWorkspaceViewStore, type RepositoryViewId } from '@/stores/workspaceViewStore';
import { useScopedSessionFiles } from '@/stores/sessionFilesStore';
import { useUIStore, type DefaultFileOpenMode } from '@/stores/uiStore';
import { useServerDataStore, selectActiveWorkspace } from '@/stores/serverDataStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { refreshGitStatus } from '@/lib/rootFeedRefresh';
import { buildFilesPanelRootOptions, resolveFilesPanelRoot } from '@/lib/sessionWorktree';
import { BranchesPanel } from '@/components/files/BranchesPanel';
import { CheckoutMenu } from '@/components/worktrees/SessionCheckoutSelector';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { KeepAliveStack } from '@/components/app/KeepAliveStack';
import { isBinaryImagePath } from '@/lib/imageFiles';

interface FilesPanelProps {
  sdkClient: ProkopaiClient | null;
  /** One repository view per panel; each is its own workspace tab. */
  view: Exclude<RepositoryViewId, 'worktrees'>;
}

export interface FilesPanelHandle {
  focus: () => void;
}

function PathSwitcher({
  options,
  selectedRoot,
  onSelect,
}: {
  options: Array<{ label: string; value: string }>;
  selectedRoot: string;
  onSelect: (root: string) => void;
}) {
  const selectedLabel = options.find((o) => o.value === selectedRoot)?.label ?? options[0].label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 min-w-0 max-w-full gap-1.5 px-2 font-semibold hover:bg-accent"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Folder className={cn('size-4 shrink-0', FOLDER_ICON_COLOR)} />
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem] max-w-[18rem]">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className="gap-2"
          >
            <Folder className={cn('size-3.5 shrink-0', FOLDER_ICON_COLOR)} />
            <span className="truncate">{opt.label}</span>
            {opt.value === selectedRoot && <Check className="size-3.5 ml-auto shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const FilesPanel = forwardRef<FilesPanelHandle, FilesPanelProps>(
  ({ sdkClient, view }, ref) => {
    const fileTreeRef = useRef<FileTreeHandle>(null);
    const gitChangesRef = useRef<GitChangesViewHandle>(null);
    const showView = useWorkspaceViewStore((s) => s.showView);
    const filesPanelRoot = useScopedSessionFiles((s) => s.filesPanelRoot);
    const filesPanelRootPinned = useScopedSessionFiles((s) => s.filesPanelRootPinned);
    const setFilesPanelRoot = useScopedSessionFiles((s) => s.setFilesPanelRoot);
    const setFilesPanelRootPinned = useScopedSessionFiles((s) => s.setFilesPanelRootPinned);
    const activeWorkspace = useServerDataStore(selectActiveWorkspace);
    const workspaceId = activeWorkspace?.id;
    const focusedSessionId = useSessionBoardStore((s) => s.focusedSessionId);
    const focusedSession = useSessionStore((s) => (
      s.sessions.find((session) => session.id === focusedSessionId) ?? null
    ));
    const worktrees = useWorktreesQuery(sdkClient, workspaceId);
    const worktreeMutations = useWorktreeMutations(sdkClient, workspaceId);
    const sessionWorktree = worktrees.data?.find((worktree) => (
      worktree.id === focusedSession?.workspaceRootId
    )) ?? focusedSession?.worktree;
    const managedRoots = useMemo(
      () => (worktrees.data ?? [])
        .filter((worktree) => worktree.state === 'available')
        .map((worktree) => worktree.path),
      [worktrees.data],
    );
    const rootOptions = useMemo(
      () => activeWorkspace
        ? buildFilesPanelRootOptions(activeWorkspace, worktrees.data ?? [])
        : [],
      [activeWorkspace, worktrees.data],
    );
    const routeParams = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
    const serverId = routeParams?.serverId as string | undefined;

    // Active editor doc (for highlighting the open file in the tree).
    const activeEditorPath = useFileEditorStore((s) => {
      if (!s.activeDocId) return undefined;
      const d = s.docs[s.activeDocId];
      if (!d) return undefined;
      if (d.identity.serverId !== (serverId ?? '') || d.identity.workspaceId !== (workspaceId ?? '')) return undefined;
      return d.identity.path;
    });
    const activeEditorRoot = useFileEditorStore((s) => {
      if (!s.activeDocId) return undefined;
      const d = s.docs[s.activeDocId];
      if (!d) return undefined;
      if (d.identity.serverId !== (serverId ?? '') || d.identity.workspaceId !== (workspaceId ?? '')) return undefined;
      return d.identity.root ?? '';
    });

    // Follow the focused session unless its saved pin is still available.
    const rootResolution = resolveFilesPanelRoot({
      workspacePath: activeWorkspace?.path ?? '',
      workspaceRootId: focusedSession?.workspaceRootId,
      worktree: sessionWorktree,
      pinnedRoot: filesPanelRoot,
      pinned: filesPanelRootPinned,
      allowedRoots: activeWorkspace ? [activeWorkspace.path, ...activeWorkspace.additionalPaths, ...managedRoots] : [],
    });
    const selectedRoot = rootResolution.selectedRoot;
    const isMainRoot = rootResolution.isPrimary;
    const rootBlocked = rootResolution.blocked;

    // Do not erase saved worktree pins during discovery. Invalid pins are
    // ignored at resolution time, so a removed root is never used for requests.

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [rootRecoveryError, setRootRecoveryError] = useState<string | null>(null);
    const [recoverySwitchOpen, setRecoverySwitchOpen] = useState(false);

    const handleRefresh = useCallback(() => {
      setIsRefreshing(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.files.browsePrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.searchPrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.browseFsPrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.parentPrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.drivesPrefix });

      if (!sdkClient || !workspaceId) {
        setIsRefreshing(false);
        return;
      }
      const logFailure = (what: string) => (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to refresh ${what}:`, message);
      };
      // Git status and the tree of a watched root come from the server feeds'
      // caches; force a recompute so changes made outside Prokop show up.
      void Promise.all([
        sdkClient.http.workspaces
          .get(workspaceId)
          .then(({ workspace: updatedWorkspace }) => {
            const store = useServerDataStore.getState();
            store.setWorkspaces(
              store.workspaces.map((w) => (w.id === updatedWorkspace.id ? updatedWorkspace : w)),
            );
          })
          .catch(logFailure('workspace')),
        refreshGitStatus(sdkClient, workspaceId, isMainRoot ? undefined : selectedRoot).catch(logFailure('Git status')),
        fileTreeRef.current?.refresh().catch(logFailure('file tree')),
      ]).finally(() => setIsRefreshing(false));
    }, [sdkClient, workspaceId, isMainRoot, selectedRoot]);

    const focus = useCallback(() => {
      const focusActiveView = () => {
        if (view === 'changes') {
          gitChangesRef.current?.focus();
        } else {
          fileTreeRef.current?.focus();
        }
      };
      showView(view);
      requestAnimationFrame(() => requestAnimationFrame(focusActiveView));
      window.setTimeout(focusActiveView, 250);
    }, [view, showView]);

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const openFilePreview = useUIStore((s) => s.openFilePreview);
    const defaultFileOpenMode = useUIStore((s) => s.defaultFileOpenMode);

    // Centralized mode-aware file opener.
    // Preview opens the read-only FilePreviewOverlay.
    // Edit opens or focuses the persistent editor document.
    const openFile = useCallback((target: FileEntryActionTarget, mode?: DefaultFileOpenMode) => {
      const { entry, root } = target;
      if (entry.type !== 'file') return;
      if (entry.git?.status === 'deleted' && mode === 'edit') return;

      // Deleted files and images have nothing to edit.
      const effectiveMode = entry.git?.status === 'deleted' || isBinaryImagePath(entry.path)
        ? 'preview'
        : mode ?? defaultFileOpenMode;

      if (workspaceId) {
        if (effectiveMode === 'preview') {
          openFilePreview({
            workspaceId,
            path: entry.path,
            name: entry.name,
            root,
          });
          return;
        }

        if (serverId) {
          useFileEditorStore.getState().openDoc(
            {
              serverId,
              workspaceId,
              root: root ?? '',
              path: entry.path,
            },
            entry.name,
          );
          // The phone shows the editor surface; on desktop the editor tab is already in place.
          useWorkspaceViewStore.getState().setMobileSurface('editor');
          return;
        }
      }
    }, [workspaceId, serverId, openFilePreview, defaultFileOpenMode]);

    const handleFileSelect = useCallback((target: FileEntryActionTarget, mode?: DefaultFileOpenMode) => {
      openFile(target, mode);
    }, [openFile]);

    // Changes-tab stats in the header row. Reads the same git-status cache
    // as GitChangesView (shared query key), so no extra request.
    const isChangesTab = view === 'changes';
    const changesRoot = isMainRoot ? undefined : selectedRoot;
    const gitStatusQuery = useGitStatusQuery(
      sdkClient,
      isChangesTab && !rootBlocked ? workspaceId : undefined,
      changesRoot,
      isChangesTab && !rootBlocked,
    );
    const changesStats = useMemo(
      () => summarizeDiffStats(gitStatusQuery.data?.files ?? []),
      [gitStatusQuery.data?.files],
    );

    const headerContent = activeWorkspace ? (
      <div className="flex flex-col gap-2 pb-2">
        <div className={cn(dockHeaderClassName(), "gap-1.5")}>
          {rootBlocked ? (
            <div className="flex min-w-0 items-center gap-1.5 px-2 text-sm font-semibold text-error">
              <GitBranch className="size-4 shrink-0" />
              <span className="truncate">Worktree unavailable</span>
            </div>
          ) : (
            <PathSwitcher
              options={rootOptions}
              selectedRoot={selectedRoot}
              onSelect={(root) => {
                setFilesPanelRoot(root);
                setFilesPanelRootPinned(true);
              }}
            />
          )}
          {filesPanelRootPinned && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setFilesPanelRoot(null);
                setFilesPanelRootPinned(false);
              }}
              aria-label="Follow focused session"
              title="Follow focused session"
            >
              <PinOff />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="ml-auto shrink-0"
            aria-label="Refresh files"
          >
            <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
          </Button>
          {view === 'explorer' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label="New file or folder">
                  <Plus className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => fileTreeRef.current?.openCreateAtRoot('file')}>
                  <FilePlus2 className="size-4" />
                  New File…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileTreeRef.current?.openCreateAtRoot('directory')}>
                  <FolderPlus className="size-4" />
                  New Folder…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isChangesTab && (gitStatusQuery.data || changesStats.fileCount > 0) && (
            <span
              className="flex shrink-0 items-center gap-1 text-2xs tabular-nums text-muted-foreground/70"
              title={`${changesStats.fileCount} changed ${changesStats.fileCount === 1 ? 'file' : 'files'}${changesStats.hasCounts ? `, +${changesStats.additions} −${changesStats.deletions}` : ''}`}
            >
              <span>{changesStats.fileCount}</span>
              {changesStats.hasCounts && (
                <>
                  <span className="text-success">+{changesStats.additions}</span>
                  <span className="text-error/80">−{changesStats.deletions}</span>
                </>
              )}
            </span>
          )}
        </div>
      </div>
    ) : null;

    const content = workspaceId && rootBlocked ? (
      <div className="p-3">
        <Alert variant="error">
          <GitBranch />
          <AlertTitle>This session's worktree is unavailable</AlertTitle>
          <AlertDescription>
            <p>
              Files, Changes, and Branches are blocked so Prokop does not silently use the primary checkout.
            </p>
            {rootRecoveryError && <p>{rootRecoveryError}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!focusedSession || worktreeMutations.unbind.isPending}
                onClick={() => {
                  if (!focusedSession) return;
                  setRootRecoveryError(null);
                  worktreeMutations.unbind.mutate(focusedSession.id, {
                    onError: (error) => setRootRecoveryError(
                      error instanceof Error ? error.message : String(error),
                    ),
                  });
                }}
              >
                Use primary checkout
              </Button>
              {focusedSession && (
                <Popover open={recoverySwitchOpen} onOpenChange={setRecoverySwitchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={worktreeMutations.bind.isPending}
                    >
                      Switch worktree
                      <ChevronDown className="size-3.5 opacity-50" data-icon="inline-end" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <CheckoutMenu
                      session={focusedSession}
                      sdkClient={sdkClient}
                      onClose={() => setRecoverySwitchOpen(false)}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </AlertDescription>
        </Alert>
      </div>
    ) : workspaceId ? (
        // Switching sessions across projects reuses the last few workspaces'
        // trees instead of rebuilding them; only the active entry holds refs.
        <KeepAliveStack
          key={`${serverId ?? ''}:${view}`}
          active={{ key: JSON.stringify([workspaceId, selectedRoot]), value: { workspaceId, root: isMainRoot ? undefined : selectedRoot } }}
        >
          {(target, active) => {
            const openEdit = (path: string, name: string) =>
              openFile({ entry: { name, type: 'file', path }, root: target.root }, 'edit');
            if (view === 'explorer') {
              return (
                <FileTree
                  ref={active ? fileTreeRef : undefined}
                  workspaceId={target.workspaceId}
                  sdkClient={sdkClient}
                  root={target.root}
                  onFileSelect={handleFileSelect}
                  activePath={active ? activeEditorPath : undefined}
                  activeRoot={active ? activeEditorRoot : undefined}
                  serverId={serverId}
                  onOpenFileEdit={openEdit}
                />
              );
            }
            if (view === 'branches') {
              return <BranchesPanel sdkClient={sdkClient} workspaceId={target.workspaceId} serverId={serverId} root={target.root} />;
            }
            return (
              <GitChangesView
                ref={active ? gitChangesRef : undefined}
                workspaceId={target.workspaceId}
                sdkClient={sdkClient}
                root={target.root}
                onFileSelect={handleFileSelect}
                serverId={serverId}
                onOpenFileEdit={openEdit}
              />
            );
          }}
        </KeepAliveStack>
    ) : null;

    if (!workspaceId) {
      return null;
    }

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar" data-workbench-explorer>
        {headerContent}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {content}
        </div>
      </div>
    );
  }
);

FilesPanel.displayName = 'FilesPanel';
