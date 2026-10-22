import { EmptyState } from '@/components/shared/States';
import { DockHeader } from '@/components/ui/dock-header';
import { SectionLabel } from '@/components/ui/section-label';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  CircleDot,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ManagedWorktree, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorktreeMutations, useWorktreeRefsQuery, useWorktreesQuery } from '@/hooks/queries';
import { useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useSessionFilesStore } from '@/stores/sessionFilesStore';
import { cn } from '@/lib/utils';
import { WorktreeCreateForm } from '@/components/worktrees/WorktreeCreateForm';
import { WorktreeSetupLogDialog } from '@/components/worktrees/WorktreeSetupLogDialog';

interface WorktreesPanelProps {
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function copyPath(path: string): void {
  void navigator.clipboard.writeText(path).then(
    () => toast.success('Path copied'),
    () => toast.error('Could not copy path'),
  );
}

function describeBlocked(worktree: ManagedWorktree): string | null {
  if (worktree.state === 'removing') return 'Removal in progress';
  if (worktree.state === 'missing') return 'Directory is missing';
  if (worktree.dirty) return 'Has uncommitted changes';
  const running = worktree.attachments.filter((a) => a.running).length;
  if (running > 0) return `${running} running session${running > 1 ? 's' : ''} — stop ${running > 1 ? 'them' : 'it'} first`;
  return null;
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? text;
}

interface SetupActions {
  onApprove: () => void;
  onRerun: () => void;
  onViewLog: () => void;
  pending: boolean;
}

function SetupAction({ onClick, disabled, children, title }: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="shrink-0 text-2xs font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/**
 * One quiet line under the worktree name: the setup step while it runs,
 * the commands with one "Run setup" action while they wait for approval,
 * the first error line with Retry and Log after a failure, the port when
 * ready. Actions stay visible, no hover, so they work on touch screens.
 */
function SetupLine({ worktree, actions }: { worktree: ManagedWorktree; actions: SetupActions }) {
  const { setup } = worktree;
  const commands = [...setup.commands.setup, ...setup.commands.teardown.map((command) => `(teardown) ${command}`)];
  const commandList = commands.join('\n');

  if (setup.state === 'running') {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="truncate" title={setup.step ?? undefined}>{setup.step ?? 'Setting up'}</span>
      </span>
    );
  }
  if (setup.state === 'needs_approval') {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <SetupAction onClick={actions.onApprove} disabled={actions.pending} title={`Run in this worktree:\n${commandList}`}>
          Run setup
        </SetupAction>
        <span className="truncate font-mono" title={commandList}>{setup.commands.setup.join(' · ')}</span>
      </span>
    );
  }
  if (setup.state === 'failed' || setup.state === 'interrupted') {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-2xs">
        <span className="truncate text-error" title={setup.error ?? undefined}>
          {setup.step ? `${setup.step}: ` : ''}{firstLine(setup.error ?? `Setup ${setup.state}`)}
        </span>
        <SetupAction onClick={actions.onRerun} disabled={actions.pending}>Retry</SetupAction>
        <SetupAction onClick={actions.onViewLog}>Log</SetupAction>
      </span>
    );
  }
  if (setup.state === 'ready' && (setup.ports || setup.warning)) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        {setup.ports && <span className="shrink-0 font-mono" title={`Ports ${setup.ports.base} to ${setup.ports.base + setup.ports.count - 1}`}>:{setup.ports.base}</span>}
        {setup.warning && <span className="truncate" title={setup.warning}>{firstLine(setup.warning)}</span>}
      </span>
    );
  }
  return null;
}

interface RowProps {
  worktree: ManagedWorktree;
  removing: boolean;
  onRemove: () => void;
  onOpenInExplorer: (worktree: ManagedWorktree) => void;
  setup: SetupActions;
}

function WorktreeRow({ worktree, removing, onRemove, onOpenInExplorer, setup }: RowProps) {
  const blocked = describeBlocked(worktree);
  const unavailable = worktree.state !== 'available' && worktree.state !== 'removed';
  const removed = worktree.state === 'removed';
  const hasSetup = worktree.setup.state !== 'none';

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/50',
        removed && 'opacity-50',
      )}
    >
      <GitBranch className={cn('size-3.5 shrink-0', unavailable ? 'text-error' : 'text-muted-foreground')} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{worktree.name}</span>
          {worktree.branch && worktree.branch !== worktree.name && (
            <span className="hidden min-w-0 truncate font-mono text-2xs text-muted-foreground sm:inline">
              ({worktree.branch})
            </span>
          )}
          {unavailable && (
            <span className="shrink-0 rounded-md bg-error/10 px-1.5 py-0.5 text-2xs font-medium text-error">
              {worktree.state}
            </span>
          )}
          {removed && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
              removed
            </span>
          )}
        </div>
        {blocked && !removed && (
          <span className="truncate text-2xs text-muted-foreground">{blocked}</span>
        )}
        {!blocked && !removed && worktree.attachments.length > 0 && (
          <span className="truncate text-2xs text-muted-foreground/70">
            {worktree.attachments.length} session{worktree.attachments.length > 1 ? 's' : ''} attached
          </span>
        )}
        {!removed && <SetupLine worktree={worktree} actions={setup} />}
        {removed && worktree.setup.warning && (
          <span className="truncate text-2xs text-muted-foreground" title={worktree.setup.warning}>
            {firstLine(worktree.setup.warning)}
          </span>
        )}
      </div>
      {removing ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              aria-label={`Actions for ${worktree.name}`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              disabled={worktree.state !== 'available'}
              onClick={() => onOpenInExplorer(worktree)}
            >
              <ExternalLink className="size-4" />
              Open in Explorer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyPath(worktree.path)}>
              <Copy className="size-4" />
              Copy path
            </DropdownMenuItem>
            {hasSetup && (
              <>
                <DropdownMenuSeparator />
                {worktree.setup.state === 'ready' && (
                  <DropdownMenuItem disabled={setup.pending || worktree.state !== 'available'} onClick={setup.onRerun}>
                    <Play className="size-4" />
                    Run setup again
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={setup.onViewLog}>
                  <FileText className="size-4" />
                  Setup log
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={Boolean(blocked) && !removed}
              onClick={onRemove}
              variant="destructive"
            >
              <Trash2 className="size-4" />
              {removed ? 'Purge record' : 'Remove'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Worktree management surface: every managed worktree in the workspace with
 * per-row open/copy/remove actions. Blocked removals explain themselves
 * inline (running session, dirty tree, missing directory) instead of
 * failing after the fact. Live-updates through worktree.updated events.
 */
export function WorktreesPanel({ sdkClient, workspaceId }: WorktreesPanelProps) {
  const [creating, setCreating] = useState(false);
  const [logWorktreeId, setLogWorktreeId] = useState<string | null>(null);
  const worktrees = useWorktreesQuery(sdkClient, workspaceId);
  const refs = useWorktreeRefsQuery(sdkClient, workspaceId);
  const mutations = useWorktreeMutations(sdkClient, workspaceId);
  const all = worktrees.data ?? [];
  // Read from the live list so the dialog follows state and step changes.
  const logWorktree = all.find((worktree) => worktree.id === logWorktreeId) ?? null;

  const setupActionsFor = (worktree: ManagedWorktree): SetupActions => ({
    pending: mutations.approveSetup.isPending || mutations.runSetup.isPending,
    onApprove: () => mutations.approveSetup.mutate(worktree.id, {
      onError: (error) => toast.error(errorMessage(error)),
    }),
    onRerun: () => mutations.runSetup.mutate(worktree.id, {
      onError: (error) => toast.error(errorMessage(error)),
    }),
    onViewLog: () => setLogWorktreeId(worktree.id),
  });

  const openInExplorer = (worktree: ManagedWorktree) => {
    // Pinning the worktree path reuses the existing root switcher so the
    // explorer and changes views follow the selected worktree root.
    const files = useSessionFilesStore.getState();
    files.setFilesPanelRoot(worktree.path);
    files.setFilesPanelRootPinned(true);
    useWorkspaceViewStore.getState().showView('explorer');
  };

  const remove = (worktree: ManagedWorktree) => {
    mutations.remove.mutate(worktree.id, {
      onSuccess: (updated) => {
        if (updated.state === 'removed') {
          // A failed teardown does not keep the worktree; it is worth one line.
          const warning = updated.setup.warning;
          if (warning && warning !== worktree.setup.warning) toast(`Removed ${worktree.name}`, { description: firstLine(warning) });
          else toast.success(`Removed ${worktree.name}`);
        } else {
          toast.error(`Could not remove ${worktree.name}`);
        }
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  const createWorktree = (input: { name: string; branch: string }, complete: () => void) => {
    mutations.create.mutate(input, {
      onSuccess: () => {
        complete();
        setCreating(false);
        toast.success(`Created ${input.name}`);
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  if (worktrees.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-worktrees-panel>
      <DockHeader className="justify-between">
        <SectionLabel>Worktrees</SectionLabel>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCreating((value) => !value)}
          aria-label={creating ? 'Close new worktree form' : 'New worktree'}
          aria-expanded={creating}
        >
          {creating ? <CircleDot className="size-3.5" /> : <Plus className="size-3.5" />}
        </Button>
      </DockHeader>

      {creating && (
        <div className="border-b border-border/50 p-2">
          <WorktreeCreateForm
            refs={refs.data ?? []}
            existingWorktreeNames={all
              .filter((worktree) => worktree.state !== 'removed')
              .map((worktree) => worktree.name)}
            refsLoading={refs.isLoading}
            pending={mutations.create.isPending}
            onCancel={() => setCreating(false)}
            onCreate={createWorktree}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {all.length === 0 ? (
          <EmptyState variant="plain">No worktrees yet. Create one to work on a branch beside the main checkout.</EmptyState>
        ) : (
          all.map((worktree) => (
            <WorktreeRow
              key={worktree.id}
              worktree={worktree}
              removing={worktree.state === 'removing'}
              onRemove={() => remove(worktree)}
              onOpenInExplorer={openInExplorer}
              setup={setupActionsFor(worktree)}
            />
          ))
        )}
      </div>
      <WorktreeSetupLogDialog
        sdkClient={sdkClient}
        workspaceId={workspaceId}
        worktree={logWorktree}
        onClose={() => setLogWorktreeId(null)}
      />
    </div>
  );
}
