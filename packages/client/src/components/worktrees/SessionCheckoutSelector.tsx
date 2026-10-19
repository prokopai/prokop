import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Folder, GitBranch, Plus } from 'lucide-react';
import type { ManagedWorktree, ProkopaiClient, Session } from '@prokopai/sdk';
import { Chip, ChipLabel } from '@/components/ui/chip';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { WorktreeCreateForm } from '@/components/worktrees/WorktreeCreateForm';
import { useWorktreeMutations, useWorktreeRefsQuery, useWorktreesQuery } from '@/hooks/queries';
import { getWorktreeDisplayName } from '@/lib/sessionWorktree';
import { cn } from '@/lib/utils';

interface CheckoutProps {
  session: Session;
  sdkClient: ProkopaiClient | null;
  disabled?: boolean;
}

interface StripProps extends CheckoutProps {
  /** Locked after the first message: renders as a non-interactive label. */
  locked?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useSessionCheckout({ session, sdkClient }: CheckoutProps) {
  const worktrees = useWorktreesQuery(sdkClient, session.workspaceId);
  const mutations = useWorktreeMutations(sdkClient, session.workspaceId);
  const all = worktrees.data ?? [];
  const available = all.filter((worktree) => worktree.state === 'available');
  const bound = all.find((worktree) => worktree.id === session.workspaceRootId)
    ?? (session.workspaceRootId ? session.worktree : null)
    ?? null;
  // Unavailable requires affirmative evidence: a fetched record (or session
  // binding) whose state is not 'available'. While the query is still
  // loading, bound is null and the strip must stay neutral, not flash red.
  const boundAvailable = !session.workspaceRootId
    || !bound
    || bound.state === 'available';
  const pending = mutations.bind.isPending
    || mutations.unbind.isPending
    || mutations.create.isPending;

  const commit = (worktreeId: string | null, onDone: () => void) => {
    onDone();
    if (worktreeId === (session.workspaceRootId ?? null)) return;
    const onError = (error: unknown) => toast.error(errorMessage(error));
    if (worktreeId === null) {
      mutations.unbind.mutate(session.id, { onError });
    } else {
      mutations.bind.mutate({ sessionId: session.id, worktreeId }, { onError });
    }
  };

  const createWorktree = (
    input: { name: string; branch: string },
    complete: () => void,
    onDone: () => void,
  ) => {
    mutations.create.mutate(input, {
      onSuccess: (worktree) => {
        mutations.bind.mutate(
          { sessionId: session.id, worktreeId: worktree.id },
          {
            onSuccess: () => {
              complete();
              onDone();
            },
            onError: (error) => toast.error(errorMessage(error)),
          },
        );
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return { all, available, bound, boundAvailable, pending, commit, createWorktree };
}

function RowMeta({ worktree }: { worktree: ManagedWorktree }) {
  const running = worktree.attachments.filter((attachment) => attachment.running).length;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 text-2xs text-muted-foreground">
      {worktree.dirty && (
        <span className="size-1.5 rounded-full bg-warning" title="Has uncommitted changes" />
      )}
      {running > 0 && (
        <span className="whitespace-nowrap">
          {running} session{running > 1 ? 's' : ''}
        </span>
      )}
    </span>
  );
}

/** Fetches refs only when the create pane is open, not for every selector render. */
function CreatePane({
  sdkClient,
  workspaceId,
  existingWorktreeNames,
  pending,
  onCancel,
  onCreate,
}: {
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
  existingWorktreeNames: string[];
  pending: boolean;
  onCancel: () => void;
  onCreate: (input: { name: string; branch: string }, complete: () => void) => void;
}) {
  const refs = useWorktreeRefsQuery(sdkClient, workspaceId);
  return (
    <WorktreeCreateForm
      refs={refs.data ?? []}
      existingWorktreeNames={existingWorktreeNames}
      refsLoading={refs.isLoading}
      pending={pending}
      onCancel={onCancel}
      onCreate={onCreate}
    />
  );
}

/**
 * Shared popover body: searchable checkout list plus an inline create pane.
 * Used by the input-row selector, the readout strip, and the Files panel
 * recovery card.
 */
export function CheckoutMenu({ session, sdkClient, onClose }: {
  session: Session;
  sdkClient: ProkopaiClient | null;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const checkout = useSessionCheckout({ session, sdkClient });
  const { all, available, bound, boundAvailable, pending, commit, createWorktree } = checkout;

  if (creating) {
    return (
      <div className="p-3">
        <CreatePane
          sdkClient={sdkClient}
          workspaceId={session.workspaceId}
          existingWorktreeNames={all
            .filter((worktree) => worktree.state !== 'removed')
            .map((worktree) => worktree.name)}
          pending={pending}
          onCancel={() => setCreating(false)}
          onCreate={(input, complete) => createWorktree(input, complete, onClose)}
        />
      </div>
    );
  }

  return (
    <Command>
      <CommandInput placeholder="Search worktrees…" />
      <CommandList>
        <CommandEmpty>No matching worktrees.</CommandEmpty>
        <CommandGroup>
          <CommandItem
            value="primary checkout"
            showCheck={false}
            onSelect={() => commit(null, onClose)}
          >
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            Primary checkout
            {!session.workspaceRootId && <Check className="ml-auto size-3.5 shrink-0" />}
          </CommandItem>
          {bound && !boundAvailable && (
            <CommandItem disabled value={`${bound.name} unavailable`}>
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{bound.name}</span>
              <span className="ml-auto text-2xs text-error">{bound.state}</span>
            </CommandItem>
          )}
          {available.map((worktree) => (
            <CommandItem
              key={worktree.id}
              value={`${worktree.name} ${worktree.branch ?? ''}`}
              showCheck={false}
              onSelect={() => commit(worktree.id, onClose)}
            >
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{worktree.name}</span>
              {worktree.branch && worktree.branch !== worktree.name && (
                <span className="truncate font-mono text-2xs text-muted-foreground">
                  {worktree.branch}
                </span>
              )}
              <RowMeta worktree={worktree} />
              {worktree.id === session.workspaceRootId && (
                <Check className="size-3.5 shrink-0" />
              )}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup>
          <CommandItem showCheck={false} onSelect={() => setCreating(true)}>
            <Plus className="size-3.5 shrink-0" />
            New worktree
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/**
 * Compact checkout picker for the input selector row. It remains available
 * with no managed worktrees so users can create the first one. On small
 * screens it stays icon-only, matching its siblings.
 */
export function SessionCheckoutSelector({ session, sdkClient, disabled }: CheckoutProps) {
  const [open, setOpen] = useState(false);
  const { bound, boundAvailable, pending } = useSessionCheckout({ session, sdkClient });

  const label = session.workspaceRootId
    ? (bound ? getWorktreeDisplayName(bound) : 'Managed checkout')
    : 'Primary checkout';
  const tooltip = `Session checkout: ${label}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip
          disabled={disabled || pending}
          aria-label={tooltip}
          title={tooltip}
          className={cn('max-w-56', !boundAvailable && 'text-error')}
        >
          {session.workspaceRootId ? <GitBranch /> : <Folder />}
          <ChipLabel>{label}</ChipLabel>
          {!boundAvailable && (
            <span className="size-1.5 shrink-0 rounded-full bg-error" title={`Worktree is ${bound?.state ?? 'unavailable'}`} />
          )}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="top" sideOffset={8}>
        <CheckoutMenu session={session} sdkClient={sdkClient} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Readout tab shown below the input for sessions bound to a worktree.
 * Displays only the worktree and branch. Interactive until the first
 * message is sent (opens the shared checkout menu to rebind); locked
 * afterwards, rendering the same content as a plain label.
 */
export function SessionCheckoutStrip({ session, sdkClient, locked }: StripProps) {
  const [open, setOpen] = useState(false);
  const { bound, boundAvailable, pending } = useSessionCheckout({ session, sdkClient });
  if (!session.workspaceRootId) return null;

  const label = bound ? getWorktreeDisplayName(bound) : 'Managed checkout';

  const content = (
    <>
      <GitBranch className="size-3 shrink-0" />
      <span className="min-w-0 truncate font-medium">{label}</span>
      {bound?.branch && bound.branch !== label && (
        <span className="hidden min-w-0 truncate text-muted-foreground/70 @lg/composer:inline">
          (<span className="font-mono">{bound.branch}</span>)
        </span>
      )}
      {!boundAvailable && (
        <span className="shrink-0">unavailable ({bound?.state ?? 'unknown'})</span>
      )}
    </>
  );

  if (locked) {
    return (
      <div className="mx-auto flex w-[85%] justify-center">
        <div
          title={boundAvailable ? 'Session checkout' : `Worktree is ${bound?.state ?? 'unavailable'}`}
          className={cn(
            'flex w-full select-none items-center justify-center gap-1.5 rounded-b-lg border border-t-0 px-2.5 py-1 text-2xs',
            boundAvailable
              ? 'border-border/50 bg-muted text-muted-foreground'
              : 'border-error/40 bg-error/15 text-error',
          )}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-[85%] justify-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={pending}
            title="Change session checkout"
            className={cn(
              'flex w-full items-center justify-center gap-1.5 rounded-b-lg border border-t-0 px-2.5 py-1 text-2xs transition-colors disabled:opacity-60',
              boundAvailable
                ? 'border-border/50 bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                : 'border-error/40 bg-error/15 text-error hover:bg-error/20',
              open && boundAvailable && 'border-ring/30',
            )}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="min-w-0 truncate font-medium">{label}</span>
            {bound?.branch && bound.branch !== label && (
              <span className="hidden min-w-0 truncate text-muted-foreground/70 @lg/composer:inline">
                (<span className="font-mono">{bound.branch}</span>)
              </span>
            )}
            {!boundAvailable && (
              <span className="shrink-0">unavailable ({bound?.state ?? 'unknown'})</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="center" side="top" sideOffset={8}>
          <CheckoutMenu session={session} sdkClient={sdkClient} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
