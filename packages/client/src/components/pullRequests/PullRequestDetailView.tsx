import { SectionLabel } from '@/components/ui/section-label';
import { lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Components } from 'react-markdown';
import { ExternalLink, Pencil, UserPlus, X } from 'lucide-react';
import type {
  PullRequestAction,
  PullRequestCheck,
  PullRequestCheckOperation,
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestSummary,
  PullRequestThread,
  PullRequestVote,
} from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { cn } from '@/lib/utils';
import { commentMarkdown, openThreads, reviewMarkdown } from './reviewMarkdown';
import {
  CopyButton,
  detailQuery,
  displayPath,
  draftKey,
  filesQuery,
  prKey,
  PrError,
  PrSelect,
  PrStateBadge,
  relativeTime,
  safePrUrl,
  StatusIcon,
  statusTone,
  usePrDraft,
  type PullRequestContext,
} from './shared';

const PullRequestFilesView = lazy(() => import('./PullRequestFilesView'));
export type ActOnPullRequest = (action: PullRequestAction) => Promise<void>;

export function PullRequestDetailView({
  ctx,
  number,
  visible,
  summary,
}: {
  ctx: PullRequestContext;
  number: number;
  visible: boolean;
  /** The list row, shown while the full PR loads. */
  summary?: PullRequestSummary;
}) {
  const cache = useQueryClient();
  const detail = useQuery({ ...detailQuery(ctx, number), enabled: visible });
  const mutationKey = [...prKey(ctx), 'action', number];
  const records = useMutationState({
    filters: { mutationKey, exact: true },
    select: (m) => ({ status: m.state.status, error: m.state.error }),
  });
  const pending = records.some((r) => r.status === 'pending');
  const mutation = useMutation({
    mutationKey,
    mutationFn: (action: PullRequestAction) => {
      if (!detail.data) throw new Error('Load the PR first.');
      return ctx.client.http.pullRequests.action(ctx.workspaceId, ctx.scope, number, {
        ...action,
        expectedHead: detail.data.head,
        accountId: detail.data.accountId,
      });
    },
    retry: false,
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: prKey(ctx) });
    },
  });
  const [tab, setTab] = useState('overview');
  const loadedHead = detail.data?.accountId === ctx.accountId ? detail.data.head : undefined;
  // Reviews almost always continue to the changed files; load them alongside the PR.
  useInfiniteQuery({ ...filesQuery(ctx, number, loadedHead ?? ''), enabled: visible && !!loadedHead });
  const act: ActOnPullRequest = async (action) => {
    if (pending) throw new Error('An operation is already in progress.');
    await mutation.mutateAsync(action);
  };
  if (detail.data && detail.data.accountId !== ctx.accountId)
    return <PrError error="The CLI account changed. Rescan connections before continuing." />;
  const pr = detail.error ? undefined : detail.data;
  const shown = pr ?? summary;
  const failure = !pr && !detail.isPending && (
    <div className="flex flex-col items-start gap-2 p-4">
      <PrError error={detail.error} />
      <Button variant="outline" onClick={() => void detail.refetch()}>
        Retry
      </Button>
    </div>
  );
  if (!shown)
    return detail.isPending ? (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32" />
      </div>
    ) : (
      failure
    );
  const conversations = pr ? pr.comments.length + pr.threads.length : 0;
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
      <header className="flex shrink-0 flex-col gap-2 border-b px-3 pt-2 @2xl:px-4 @2xl:pt-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug @2xl:text-lg">
            {shown.title} <span className="font-normal text-muted-foreground">#{number}</span>
          </h2>
          {/* Narrow panes keep the whole width for the title; the link shrinks to its icon. */}
          <Button variant="ghost" size="sm" className="shrink-0 @max-2xl:size-8 @max-2xl:px-0" asChild>
            <a
              href={safePrUrl(shown.url)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open on ${ctx.provider === 'github' ? 'GitHub' : 'Azure'}`}
              title={`Open on ${ctx.provider === 'github' ? 'GitHub' : 'Azure'}`}
            >
              <span className="hidden @2xl:inline">Open on {ctx.provider === 'github' ? 'GitHub' : 'Azure'}</span>
              <ExternalLink />
            </a>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <PrStateBadge pr={shown} />
          <span>
            {shown.author.name}
            {shown.updatedAt && ` · updated ${relativeTime(shown.updatedAt)}`}
          </span>
          <span className="flex min-w-0 items-center gap-1 font-mono">
            <code className="truncate rounded-md bg-muted px-1.5 py-0.5">{shown.sourceBranch}</code>→
            <code className="truncate rounded-md bg-muted px-1.5 py-0.5">{shown.targetBranch}</code>
          </span>
        </div>
        <TabsList variant="line" className="-mb-px">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="activity">
            Activity
            {conversations > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5">
                {conversations}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </header>
      {!pr ? (
        (failure || (
          <div className="flex flex-col gap-3 p-4" aria-busy="true">
            <Skeleton className="h-32" />
            <Skeleton className="h-20" />
          </div>
        ))
      ) : (
        <div className="@container min-h-0 flex-1 overflow-auto p-3 @2xl:p-4">
          <div className="mb-3 flex flex-col gap-2 empty:hidden">
            <PrError error={records.at(-1)?.error} />
            {records.at(-1)?.status === 'success' && (
              <p role="status" className="text-xs text-muted-foreground">
                Action accepted. Remote merges and checks may still be processing.
              </p>
            )}
            {pr.warnings.map((w) => (
              <p key={w} role="status" className="text-sm text-warning">
                {w}
              </p>
            ))}
          </div>
          <TabsContent value="overview">
            <Overview key={`${pr.head}:${pr.targetBranch}`} ctx={ctx} pr={pr} act={act} busy={pending} />
          </TabsContent>
          <TabsContent value="activity" className="flex flex-col gap-3">
            {conversations > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-1">
                <CopyButton
                  text={() => reviewMarkdown(pr, 'open')}
                  label="Copy unresolved review threads as markdown"
                  disabled={!openThreads(pr).length}
                >
                  Copy unresolved ({openThreads(pr).length})
                </CopyButton>
                <CopyButton text={() => reviewMarkdown(pr, 'all')} label="Copy all comments as markdown">
                  Copy all
                </CopyButton>
              </div>
            )}
            {pr.comments.map((c) => (
              <article key={`${c.id}:${c.createdAt}`} className="rounded-md border p-3">
                <CommentMeta name={c.author.name} createdAt={c.createdAt} copy={commentMarkdown(c)} />
                <Markdown body={c.body} />
              </article>
            ))}
            {pr.threads.map((t) => (
              <Thread key={t.id} ctx={ctx} pr={pr} thread={t} act={act} busy={pending} />
            ))}
            {!conversations && <p className="text-sm text-muted-foreground">No conversation yet.</p>}
            <ReviewForm ctx={ctx} pr={pr} act={act} busy={pending} />
          </TabsContent>
          <TabsContent value="files">
            {tab === 'files' && (
              <Suspense fallback={<Skeleton className="h-32" />}>
                <PullRequestFilesView ctx={ctx} pr={pr} act={act} busy={pending} />
              </Suspense>
            )}
          </TabsContent>
        </div>
      )}
    </Tabs>
  );
}

/** PR text is untrusted: only https links, and no remote images (they would leak the viewer's IP). */
const untrusted: Components = {
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || 'Image'}, open on provider]</span>,
  a: ({ href, children }) => (
    <a
      href={href ? safePrUrl(href) : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  ),
};

function Markdown({ body }: { body: string }) {
  return (
    <MarkdownRenderer overrides={untrusted} className="space-y-2 text-sm [&_li]:my-0.5">
      {body}
    </MarkdownRenderer>
  );
}

function CommentMeta({ name, createdAt, copy }: { name: string; createdAt: string; copy: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
      <p className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{name}</span>
        {createdAt && (
          <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>
            {' · '}
            {relativeTime(createdAt)}
          </time>
        )}
      </p>
      <CopyButton text={copy} label={`Copy ${name}'s comment as markdown`} />
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel asChild>
        <h3 className="gap-2">
          <span className="flex-1">{title}</span>
          {aside}
      </h3>
      </SectionLabel>
      {children}
    </section>
  );
}

function Overview({
  ctx,
  pr,
  act,
  busy,
}: {
  ctx: PullRequestContext;
  pr: PullRequestDetail;
  act: ActOnPullRequest;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [method, setMethod] = useState<PullRequestMergeMethod>(pr.mergeMethods[0] ?? 'squash');
  const [confirm, setConfirm] = useState<'merge' | 'close' | 'auto' | null>(null);
  const perform = (action: PullRequestAction) => {
    void act(action).catch(() => {});
  };
  const passed = pr.checks.filter((c) => statusTone(c.state) === 'success').length;
  const failed = pr.checks.filter((c) => statusTone(c.state) === 'failure').length;
  const complete = ctx.provider === 'azure' ? 'Complete' : 'Merge';
  return (
    <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-5">
        {editing ? (
          <EditForm ctx={ctx} pr={pr} act={act} busy={busy} close={() => setEditing(false)} />
        ) : (
          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
              <span className="flex-1">Description</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Edit title and description"
                title="Edit title and description"
                onClick={() => setEditing(true)}
                disabled={busy || pr.state === 'merged'}
              >
                <Pencil />
              </Button>
            </div>
            <div className="p-3">
              {pr.body ? (
                <Markdown body={pr.body} />
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
            </div>
          </div>
        )}
        <ReviewForm ctx={ctx} pr={pr} act={act} busy={busy} />
      </div>
      <aside className="flex min-w-0 flex-col gap-6">
        <Section title="Reviewers">
          {pr.reviewers.length === 0 && <p className="text-sm text-muted-foreground">No reviewers yet.</p>}
          {pr.reviewers.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <StatusIcon state={r.vote} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.vote}</span>
              </span>
              {pr.state === 'open' &&
                (ctx.provider === 'azure' || pr.requestedReviewerIds?.includes(r.id)) && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    aria-label={`${ctx.provider === 'github' ? 'Cancel review request for' : 'Remove'} ${r.name}`}
                    onClick={() =>
                      perform({
                        action: 'reviewer',
                        reviewer: ctx.provider === 'github' ? r.name : r.id,
                        remove: true,
                      })
                    }
                  >
                    <X />
                  </Button>
                )}
            </div>
          ))}
          {pr.state === 'open' && (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: 'reviewer', reviewer: reviewer.trim(), remove: false })
                  .then(() => setReviewer(''))
                  .catch(() => {});
              }}
            >
              <Input
                aria-label="Reviewer"
                className="h-7 text-xs"
                placeholder={ctx.provider === 'github' ? 'Add GitHub username' : 'Add reviewer e-mail'}
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                aria-label="Request review"
                title="Request review"
                disabled={busy || !reviewer.trim()}
              >
                <UserPlus />
              </Button>
            </form>
          )}
        </Section>
        <Section
          title={ctx.provider === 'azure' ? 'Checks and policies' : 'Checks'}
          aside={
            pr.checks.length > 0 && (
              <span className={cn('normal-case tracking-normal', failed ? 'text-error' : '')}>
                {passed}/{pr.checks.length} passed
              </span>
            )
          }
        >
          {pr.checks.length ? (
            pr.checks.map((c, i) => (
              <div key={`${c.name}:${i}`} className="flex items-center gap-2 text-sm" title={`${c.name}: ${c.state}`}>
                <StatusIcon state={c.state} />
                <span className="min-w-0 flex-1 truncate">
                  {c.url ? (
                    <a
                      href={safePrUrl(c.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}
                </span>
                {statusTone(c.state) !== 'success' && (
                  <span className="shrink-0 text-xs text-muted-foreground">{c.state}</span>
                )}
                <CheckActions pr={pr} check={c} act={act} busy={busy} />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No check results reported.</p>
          )}
        </Section>
        <Section title={ctx.provider === 'azure' ? 'Completion' : 'Merge'}>
          <div className="flex flex-col gap-3 rounded-md border p-3">
            {/* Mergeability only matters while the PR is open; a finished PR states its outcome. */}
            <p className="flex items-center gap-2 text-sm">
              {pr.state === 'merged' ? (
                <>
                  <StatusIcon state="success" />
                  <span>
                    Merged into <code className="rounded-md bg-muted px-1 py-0.5 text-xs">{pr.targetBranch}</code>
                  </span>
                </>
              ) : pr.state === 'closed' ? (
                <>
                  <StatusIcon state="closed" />
                  {ctx.provider === 'azure' ? 'Abandoned without completing' : 'Closed without merging'}
                </>
              ) : (
                <>
                  <StatusIcon
                    state={
                      pr.mergeability === 'mergeable'
                        ? 'success'
                        : pr.mergeability === 'conflicting'
                          ? 'failure'
                          : 'pending'
                    }
                  />
                  {pr.mergeability === 'mergeable'
                    ? 'No merge conflicts'
                    : pr.mergeability === 'conflicting'
                      ? 'Merge conflicts must be resolved'
                      : 'Merge status not yet known'}
                </>
              )}
            </p>
            {pr.state === 'closed' && (
              <Button variant="outline" disabled={busy} onClick={() => perform({ action: 'reopen' })}>
                Reopen PR
              </Button>
            )}
            {pr.state === 'open' && (
              <>
                {!pr.draft && pr.mergeMethods.length > 0 && (
                  <>
                    <PrSelect
                      label="Merge method"
                      value={method}
                      onChange={(v) => setMethod(v as PullRequestMergeMethod)}
                      options={pr.mergeMethods.map((value) => ({
                        value,
                        label:
                          value === 'rebase-merge'
                            ? 'Rebase with merge commit'
                            : value[0].toUpperCase() + value.slice(1),
                      }))}
                    />
                    <Button
                      disabled={busy || pr.mergeability === 'conflicting' || !pr.mergeMethods.includes(method)}
                      onClick={() => setConfirm('merge')}
                    >
                      {complete} PR
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || (!pr.autoMerge && !pr.mergeMethods.includes(method))}
                      onClick={() =>
                        pr.autoMerge ? perform({ action: 'disable-auto-merge' }) : setConfirm('auto')
                      }
                    >
                      {pr.autoMerge ? 'Disable automatic merge' : 'Merge when checks pass'}
                    </Button>
                    {pr.autoMerge && (
                      <p className="text-xs text-success">Automatic merge is on.</p>
                    )}
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => perform({ action: pr.draft ? 'ready' : 'draft' })}
                  >
                    {pr.draft ? 'Ready for review' : 'Convert to draft'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => setConfirm('close')}
                  >
                    {ctx.provider === 'azure' ? 'Abandon' : 'Close'} PR
                  </Button>
                </div>
              </>
            )}
            {pr.state === 'open' && (
              <p className="text-xs text-muted-foreground">The provider enforces repository policies.</p>
            )}
          </div>
        </Section>
      </aside>
      <ConfirmationDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        variant={confirm === 'close' ? 'destructive' : 'default'}
        title={
          confirm === 'auto'
            ? `Enable automatic merge for #${pr.number}?`
            : confirm === 'merge'
              ? `${complete} #${pr.number}?`
              : `${ctx.provider === 'azure' ? 'Abandon' : 'Close'} #${pr.number}?`
        }
        description={
          confirm === 'auto'
            ? `The provider will merge ${pr.sourceBranch} into ${pr.targetBranch} using ${method} when eligible, possibly immediately.`
            : confirm === 'merge'
              ? `${pr.sourceBranch} → ${pr.targetBranch}, using ${method}. This changes the remote repository.`
              : 'This closes the remote pull request without merging it.'
        }
        confirmLabel={
          confirm === 'auto'
            ? 'Enable automatic merge'
            : confirm === 'merge'
              ? `${complete} PR`
              : `${ctx.provider === 'azure' ? 'Abandon' : 'Close'} PR`
        }
        loading={busy}
        onConfirm={() => {
          void act(
            confirm === 'auto'
              ? { action: 'enable-auto-merge', method }
              : confirm === 'merge'
                ? { action: 'merge', method }
                : { action: 'close' },
          )
            .then(() => setConfirm(null))
            .catch(() => {});
        }}
      />
    </div>
  );
}

type ConfirmedOperation = Extract<PullRequestCheckOperation, 'approve-run' | 'approve-deployment' | 'reject-deployment'>;

/** Start a check from Prokop. Approvals run or deploy someone's code, so they ask first. */
function CheckActions({
  pr,
  check,
  act,
  busy,
}: {
  pr: PullRequestDetail;
  check: PullRequestCheck;
  act: ActOnPullRequest;
  busy: boolean;
}) {
  const [confirm, setConfirm] = useState<ConfirmedOperation | null>(null);
  const action = check.action;
  if (!action || pr.state !== 'open') return null;
  const environments = action.environments ?? [];
  const names = environments.map((e) => e.name).join(', ');
  const start = (operation: PullRequestCheckOperation) =>
    act({
      action: 'check',
      operation,
      target: action.target,
      ...(operation.endsWith('-deployment') ? { environmentIds: environments.map((e) => e.id) } : {}),
    });
  const button = (label: string, onClick: () => void, className?: string) => (
    <Button
      key={label}
      type="button"
      variant="ghost"
      size="xs"
      className={cn('shrink-0', className)}
      disabled={busy}
      aria-label={`${label}: ${check.name}`}
      onClick={onClick}
    >
      {label}
    </Button>
  );
  const dialog = {
    'approve-run': {
      title: `Run ${check.name} for #${pr.number}?`,
      description: `The workflow runs the changes from ${pr.author.name} on ${pr.sourceBranch}. Approve only if you trust this code.`,
      label: 'Approve and run',
    },
    'approve-deployment': {
      title: `Approve deployment to ${names}?`,
      description: `${check.name} continues and deploys ${pr.sourceBranch} to ${names}.`,
      label: 'Approve deployment',
    },
    'reject-deployment': {
      title: `Reject deployment to ${names}?`,
      description: `${check.name} stops and its workflow run fails.`,
      label: 'Reject deployment',
    },
  };
  const now = (operation: PullRequestCheckOperation) => () => void start(operation).catch(() => {});
  return (
    <>
      {action.kind === 'queue' && button('Queue', now('queue'))}
      {action.kind === 'rerun' && button('Re-run', now('rerun'))}
      {action.kind === 'approve-run' && button('Approve and run', () => setConfirm('approve-run'))}
      {action.kind === 'review-deployment' && [
        button('Approve', () => setConfirm('approve-deployment')),
        button('Reject', () => setConfirm('reject-deployment'), 'text-destructive'),
      ]}
      {confirm && (
        <ConfirmationDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirm(null);
          }}
          variant={confirm === 'reject-deployment' ? 'destructive' : 'default'}
          title={dialog[confirm].title}
          description={dialog[confirm].description}
          confirmLabel={dialog[confirm].label}
          loading={busy}
          onConfirm={() => {
            void start(confirm)
              .then(() => setConfirm(null))
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}

function EditForm({
  ctx,
  pr,
  act,
  busy,
  close,
}: {
  ctx: PullRequestContext;
  pr: PullRequestDetail;
  act: ActOnPullRequest;
  busy: boolean;
  close(): void;
}) {
  const [saved, setSaved, clearSaved] = usePrDraft(draftKey(ctx, pr.number, 'edit'));
  const [draft, setDraft] = useState(() => {
    try {
      const value: unknown = JSON.parse(saved);
      if (
        value &&
        typeof value === 'object' &&
        'title' in value &&
        typeof value.title === 'string' &&
        'body' in value &&
        typeof value.body === 'string'
      )
        return { title: value.title, body: value.body };
    } catch {
      /* First edit. */
    }
    return { title: pr.title, body: pr.body };
  });
  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaved(JSON.stringify(next));
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: 'edit', ...draft })
          .then(() => {
            clearSaved();
            close();
          })
          .catch(() => {});
      }}
    >
      <Label htmlFor="pr-edit-title">Title</Label>
      <Input
        id="pr-edit-title"
        value={draft.title}
        onChange={(e) => update({ title: e.target.value })}
        maxLength={300}
        required
      />
      <Label htmlFor="pr-edit-body">Description</Label>
      <Textarea
        id="pr-edit-body"
        value={draft.body}
        onChange={(e) => update({ body: e.target.value })}
        rows={8}
        maxLength={60000}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !draft.title.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ReviewForm({
  ctx,
  pr,
  act,
  busy,
}: {
  ctx: PullRequestContext;
  pr: PullRequestDetail;
  act: ActOnPullRequest;
  busy: boolean;
}) {
  const [body, setBody, clearBody] = usePrDraft(draftKey(ctx, pr.number, 'review'));
  const [selectedVerdict, setVerdict] = useState<PullRequestVote>('comment');
  const canReview = pr.state === 'open' && (ctx.provider === 'azure' || pr.author.id !== ctx.accountId);
  const verdict = canReview ? selectedVerdict : 'comment';
  const options = [
    { value: 'comment', label: 'Comment' },
    ...(canReview
      ? [
          { value: 'approve', label: 'Approve' },
          ...(ctx.provider === 'azure'
            ? [{ value: 'approve-with-suggestions', label: 'Approve with suggestions' }]
            : []),
          { value: 'request-changes', label: ctx.provider === 'azure' ? 'Reject' : 'Request changes' },
          ...(ctx.provider === 'azure'
            ? [
                { value: 'wait', label: 'Wait for author' },
                { value: 'reset', label: 'Reset vote' },
              ]
            : []),
        ]
      : []),
  ];
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void act(verdict === 'comment' ? { action: 'comment', body } : { action: 'review', verdict, body })
          .then(() => {
            clearBody();
            setVerdict('comment');
          })
          .catch(() => {});
      }}
    >
      <Textarea
        aria-label="Review feedback"
        placeholder="Leave a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={60000}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {options.length > 1 && (
          <Select value={verdict} onValueChange={(v) => setVerdict(v as PullRequestVote)}>
            <SelectTrigger aria-label="Review" size="sm" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={busy || (['comment', 'request-changes'].includes(verdict) && !body.trim())}
        >
          {busy ? 'Submitting…' : verdict === 'comment' ? 'Post comment' : 'Submit review'}
        </Button>
      </div>
    </form>
  );
}

export function Thread({
  ctx,
  pr,
  thread,
  act,
  busy,
}: {
  ctx: PullRequestContext;
  pr: PullRequestDetail;
  thread: PullRequestThread;
  act: ActOnPullRequest;
  busy: boolean;
}) {
  const [reply, setReply, clearReply] = usePrDraft(draftKey(ctx, pr.number, `reply:${thread.id}`));
  const [expanded, setExpanded] = useState(!thread.resolved);
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-background p-3 text-foreground',
        thread.resolved && 'bg-muted/30',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 break-all font-mono text-muted-foreground">
          {thread.path ? `${displayPath(thread.path)}${thread.line ? `:${thread.line}` : ''}` : 'General'}
        </span>
        {thread.outdated && <Badge variant="secondary">Outdated</Badge>}
        <Badge variant="outline" className={thread.resolved ? 'text-success' : 'text-warning'}>
          {thread.resolved ? 'Resolved' : 'Open'}
        </Badge>
        {thread.resolved && (
          <Button type="button" variant="ghost" size="xs" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : 'Show'}
          </Button>
        )}
      </div>
      {expanded && (
        <>
          {thread.comments.map((c) => (
            <div key={c.id}>
              <CommentMeta name={c.author.name} createdAt={c.createdAt} copy={commentMarkdown(c, thread)} />
              <Markdown body={c.body} />
            </div>
          ))}
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: 'reply', threadId: thread.id, body: reply })
                .then(clearReply)
                .catch(() => {});
            }}
          >
            <Textarea
              aria-label="Reply to conversation"
              placeholder="Reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              maxLength={60000}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || !reply.trim()}>
                Reply
              </Button>
              {thread.canResolve && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    void act({ action: 'resolve', threadId: thread.id, resolved: !thread.resolved }).catch(
                      () => {},
                    );
                  }}
                >
                  {thread.resolved ? 'Reopen conversation' : 'Resolve'}
                </Button>
              )}
            </div>
          </form>
        </>
      )}
    </article>
  );
}
