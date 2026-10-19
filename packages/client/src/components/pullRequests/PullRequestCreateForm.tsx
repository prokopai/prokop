import { Switch } from '@/components/ui/switch';
import { FormGrid, SettingsRow } from '@/components/ui/settings-row';
import { useState } from 'react';
import { useMutation, useMutationState } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { draftKey, PrError, usePrDraft, type PullRequestContext } from './shared';

export function PullRequestCreateForm({
  ctx,
  branch,
  onCreated,
  onCancel,
}: {
  ctx: PullRequestContext;
  branch: string;
  onCreated(number: number): void;
  onCancel(): void;
}) {
  const [title, setTitle, clearTitle] = usePrDraft(draftKey(ctx, 'create', 'title'));
  const [body, setBody, clearBody] = usePrDraft(draftKey(ctx, 'create', 'body'));
  const [savedSource, saveSource, clearSource] = usePrDraft(draftKey(ctx, 'create', 'source'));
  const [source, setSource] = useState(savedSource || branch);
  const [target, setTarget] = usePrDraft(draftKey(ctx, 'create', 'target'));
  const [mode, setMode, clearMode] = usePrDraft(draftKey(ctx, 'create', 'mode'));
  const draft = mode !== 'ready';
  const pending =
    useMutationState({
      filters: { mutationKey: prKeyForCreate(ctx), exact: true, status: 'pending' },
      select: () => true,
    }).length > 0;
  const mutation = useMutation({
    mutationKey: [...prKeyForCreate(ctx)],
    mutationFn: () =>
      ctx.client.http.pullRequests.create(ctx.workspaceId, ctx.scope, {
        title,
        body,
        sourceBranch: source,
        targetBranch: target,
        draft,
        accountId: ctx.accountId,
      }),
    retry: false,
    onSuccess: (pr) => {
      clearTitle();
      clearBody();
      clearSource();
      clearMode();
      onCreated(pr.number);
    },
  });
  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) mutation.mutate();
      }}
    >
      <h2 className="text-base font-medium">Create pull request</h2>
      <FormGrid>
        <SettingsRow label="Source branch" htmlFor="pr-source" description={ctx.provider === 'github' ? 'owner:branch for a fork. Push it first from Branches; creating a PR does not push.' : 'Push it first from Branches; creating a PR does not push.'}>
          <Input
            id="pr-source"
            disabled={pending}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              saveSource(e.target.value);
            }}
            required
            className="font-mono sm:w-64"
          />
        </SettingsRow>
        <SettingsRow label="Target branch" htmlFor="pr-target">
          <Input
            id="pr-target"
            disabled={pending}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
            className="font-mono sm:w-64"
          />
        </SettingsRow>
        <SettingsRow label="Title" htmlFor="pr-title" stacked>
          <Input
            id="pr-title"
            disabled={pending}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={300}
          />
        </SettingsRow>
        <SettingsRow label="Description" htmlFor="pr-body" stacked>
          <Textarea
            id="pr-body"
            disabled={pending}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            maxLength={60000}
          />
        </SettingsRow>
        <SettingsRow label="Create as draft" htmlFor="pr-draft">
          <Switch
            id="pr-draft"
            disabled={pending}
            checked={draft}
            onCheckedChange={(checked) => setMode(checked ? '' : 'ready')}
          />
        </SettingsRow>
      </FormGrid>
      <PrError error={mutation.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !title.trim() || !source || !target}>
          {pending ? 'Creating…' : 'Create PR'}
        </Button>
      </div>
    </form>
  );
}
const prKeyForCreate = (ctx: PullRequestContext) => [
  'pr-create',
  ctx.serverId,
  ctx.workspaceId,
  ctx.scope.repositoryKey,
];
