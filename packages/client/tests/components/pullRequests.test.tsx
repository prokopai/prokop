import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient, PullRequestDetail, PullRequestSummary } from '@prokopai/sdk';
import { PullRequestDetailView } from '@/components/pullRequests/PullRequestDetailView';
import { PullRequestCreateForm } from '@/components/pullRequests/PullRequestCreateForm';
import {
  displayPath,
  draftKey,
  prKey,
  statusTone,
  usePrDrafts,
  type PullRequestContext,
} from '@/components/pullRequests/shared';

const head = 'a'.repeat(40);
const pr: PullRequestDetail = {
  number: 7,
  title: 'Fix login',
  body: 'Details',
  url: 'https://github.com/acme/app/pull/7',
  author: { id: 'author', name: 'Alice' },
  state: 'open',
  draft: false,
  sourceBranch: 'feature',
  targetBranch: 'main',
  head,
  base: 'b'.repeat(40),
  updatedAt: '2026-10-08',
  accountId: 'reviewer',
  reviewers: [],
  checks: [],
  comments: [],
  threads: [],
  warnings: [],
  mergeMethods: ['squash'],
  mergeability: 'mergeable',
};
const action = vi.fn();
const detail = vi.fn();
const createPr = vi.fn();
const files = vi.fn();
const patch = vi.fn();
const client = {
  http: { pullRequests: { detail, action, create: createPr, files, patch } },
} as unknown as ProkopaiClient;
const ctx: PullRequestContext = {
  client,
  serverId: 'server',
  workspaceId: 'ws',
  scope: { root: '/worktree', remote: 'origin', repositoryKey: 'github:acme/app' },
  accountId: 'reviewer',
  provider: 'github',
};
beforeEach(() => {
  action.mockReset().mockResolvedValue({ ok: true });
  detail.mockReset().mockResolvedValue(pr);
  createPr.mockReset().mockResolvedValue(pr);
  files.mockReset().mockResolvedValue({ files: [], nextPage: null, head });
  patch.mockReset().mockResolvedValue({ patch: '' });
  usePrDrafts.setState({ values: {} });
});
afterEach(cleanup);
function show(
  context = ctx,
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
  summary?: PullRequestSummary,
) {
  const result = render(
    <QueryClientProvider client={cache}>
      <PullRequestDetailView ctx={context} number={7} visible summary={summary} />
    </QueryClientProvider>,
  );
  return { ...result, cache };
}
test('posts feedback with exact repository, account and reviewed head, then clears only the successful draft', async () => {
  show();
  const field = await screen.findByRole('textbox', { name: 'Review feedback' });
  fireEvent.change(field, { target: { value: 'Please test this edge case.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith('ws', ctx.scope, 7, {
      action: 'comment',
      body: 'Please test this edge case.',
      expectedHead: head,
      accountId: 'reviewer',
    }),
  );
  await waitFor(() => expect(field).toHaveValue(''));
});
test('failed writes retain feedback and do not retry automatically', async () => {
  action.mockRejectedValue(new Error('The provider refused this operation.'));
  show();
  const field = await screen.findByRole('textbox', { name: 'Review feedback' });
  fireEvent.change(field, { target: { value: 'Keep my feedback' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  expect(await screen.findByText('The provider refused this operation.')).toBeInTheDocument();
  expect(field).toHaveValue('Keep my feedback');
  expect(action).toHaveBeenCalledTimes(1);
});
test('successful submission preserves a newer draft written while the request was pending', async () => {
  let finish!: (value: { ok: true }) => void;
  action.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  const field = await screen.findByRole('textbox', { name: 'Review feedback' });
  fireEvent.change(field, { target: { value: 'First comment' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  fireEvent.change(field, { target: { value: 'My next comment' } });
  finish({ ok: true });
  await screen.findByRole('button', { name: 'Post comment' });
  expect(field).toHaveValue('My next comment');
});
test('a changed head dismisses an open merge confirmation before it can apply to new changes', async () => {
  const { cache } = show();
  fireEvent.click(await screen.findByRole('button', { name: 'Merge PR' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  cache.setQueryData([...prKey(ctx), 'detail', 7], { ...pr, head: 'c'.repeat(40) });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(action).not.toHaveBeenCalled();
});
test('drafts survive navigation and are isolated by repository and account', async () => {
  const first = show();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Review feedback' }), {
    target: { value: 'Saved feedback' },
  });
  first.unmount();
  const second = show();
  expect(await screen.findByRole('textbox', { name: 'Review feedback' })).toHaveValue('Saved feedback');
  second.unmount();
  detail.mockResolvedValue({ ...pr, accountId: 'other' });
  show({ ...ctx, accountId: 'other' });
  expect(await screen.findByRole('textbox', { name: 'Review feedback' })).toHaveValue('');
  expect(usePrDrafts.getState().values[draftKey(ctx, 7, 'review')]).toBe('Saved feedback');
});
test('a pending action remains disabled after the detail panel remounts', async () => {
  let finish!: (value: { ok: true }) => void;
  action.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = show();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Review feedback' }), {
    target: { value: 'Only once' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  first.unmount();
  show(ctx, first.cache);
  expect(await screen.findByRole('button', { name: 'Submitting…' })).toBeDisabled();
  finish({ ok: true });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Review feedback' })).toHaveValue(''));
  fireEvent.change(screen.getByRole('textbox', { name: 'Review feedback' }), {
    target: { value: 'Next comment' },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Post comment' })).toBeEnabled());
});
test('refuses to act through a detail response from a different CLI account', async () => {
  detail.mockResolvedValue({ ...pr, accountId: 'someone-else' });
  show();
  expect(
    await screen.findByText('The CLI account changed. Rescan connections before continuing.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Merge PR' })).not.toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
});
test('the list row is shown while the full pull request loads', async () => {
  let finish!: (value: PullRequestDetail) => void;
  detail.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show(ctx, undefined, { ...pr, title: 'Fix login (from list)' });
  expect(screen.getByRole('heading', { name: /Fix login \(from list\)/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Merge PR' })).not.toBeInTheDocument();
  finish(pr);
  expect(await screen.findByRole('button', { name: 'Merge PR' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Fix login/ })).not.toHaveTextContent('from list');
});
test('changed files load with the pull request, before the Files tab opens', async () => {
  show();
  await screen.findByRole('button', { name: 'Merge PR' });
  await waitFor(() => expect(files).toHaveBeenCalledWith('ws', ctx.scope, 7, head, 1));
});
test('a file whose patch came with the file list opens without another request', async () => {
  files.mockResolvedValue({
    files: [
      {
        path: 'src/a.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        diff: { patch: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n' },
      },
      {
        path: 'logo.png',
        status: 'added',
        additions: 0,
        deletions: 0,
        diff: { patch: '', unavailable: 'GitHub did not provide a text patch for this file.' },
      },
    ],
    nextPage: null,
    head,
  });
  show();
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Files' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
  expect(await screen.findByText(/Click a line number to comment/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /logo\.png/ }));
  expect(await screen.findByText('GitHub did not provide a text patch for this file.')).toBeInTheDocument();
  expect(patch).not.toHaveBeenCalled();
});
test('a blocking pipeline is queued with one click, against the reviewed commit', async () => {
  const target = '11111111-2222-3333-4444-555555555555';
  detail.mockResolvedValue({
    ...pr,
    checks: [{ name: 'CI', state: 'queued', action: { kind: 'queue', target } }],
  });
  show({ ...ctx, provider: 'azure' });
  fireEvent.click(await screen.findByRole('button', { name: 'Queue: CI' }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith('ws', ctx.scope, 7, {
      action: 'check',
      operation: 'queue',
      target,
      expectedHead: head,
      accountId: 'reviewer',
    }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('running a contributor workflow and deploying ask first', async () => {
  detail.mockResolvedValue({
    ...pr,
    checks: [
      { name: 'CI', state: 'action_required', action: { kind: 'approve-run', target: '40' } },
      {
        name: 'deploy',
        state: 'waiting',
        action: { kind: 'review-deployment', target: '43', environments: [{ id: 5, name: 'staging' }] },
      },
    ],
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Approve and run: CI' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Approve only if you trust this code.');
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Approve and run' }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith('ws', ctx.scope, 7, expect.objectContaining({ operation: 'approve-run', target: '40' })),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Reject: deploy' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reject deployment' }));
  await waitFor(() =>
    expect(action).toHaveBeenLastCalledWith(
      'ws',
      ctx.scope,
      7,
      expect.objectContaining({ operation: 'reject-deployment', target: '43', environmentIds: [5] }),
    ),
  );
});
test('closed pull requests offer no pipeline actions', async () => {
  detail.mockResolvedValue({
    ...pr,
    state: 'closed',
    checks: [{ name: 'test', state: 'failure', action: { kind: 'rerun', target: '55' } }],
  });
  show();
  expect(await screen.findByText('test')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Re-run: test' })).not.toBeInTheDocument();
});
test('review feedback copies as markdown, all of it or one comment', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  try {
    detail.mockResolvedValue({
      ...pr,
      threads: [
        {
          id: 'T_1',
          path: 'src/a.ts',
          line: 4,
          resolved: false,
          outdated: false,
          canResolve: true,
          comments: [{ id: '1', author: { id: 'b', name: 'bob' }, body: 'Why **this**?', createdAt: '2026-10-08' }],
        },
      ],
    });
    show();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Activity/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy unresolved (1)' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '## Review comments on #7: Fix login\n\n### src/a.ts:4\n\n**bob:**\n\nWhy **this**?\n',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: "Copy bob's comment as markdown" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith('### src/a.ts:4\n\n**bob:**\n\nWhy **this**?\n'),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
test('copying unresolved feedback is unavailable when every thread is resolved', async () => {
  detail.mockResolvedValue({
    ...pr,
    comments: [{ id: '1', author: { id: 'c', name: 'carol' }, body: 'Thanks', createdAt: '2026-10-08' }],
  });
  show();
  fireEvent.mouseDown(await screen.findByRole('tab', { name: /Activity/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
  expect(await screen.findByRole('button', { name: 'Copy unresolved (0)' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Copy all' })).toBeEnabled();
});
test('creation uses a published source and explicit target without calling Git push', async () => {
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PullRequestCreateForm ctx={ctx} branch="feature" onCreated={onCreated} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Target branch'), { target: { value: 'main' } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New feature' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create PR' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(7));
  expect(createPr).toHaveBeenCalledWith('ws', ctx.scope, {
    title: 'New feature',
    body: '',
    sourceBranch: 'feature',
    targetBranch: 'main',
    draft: true,
    accountId: 'reviewer',
  });
});
test('query keys separate servers, checkouts and signed-in accounts', () => {
  expect(prKey(ctx)).not.toEqual(prKey({ ...ctx, serverId: 'another-server' }));
  expect(prKey(ctx)).not.toEqual(prKey({ ...ctx, accountId: 'another-user' }));
  expect(prKey(ctx)).not.toEqual(prKey({ ...ctx, scope: { ...ctx.scope, root: '/another-checkout' } }));
});
test.each([
  ['succeeded', 'success'],
  ['Approved with suggestions', 'success'],
  ['APPROVED', 'success'],
  ['CHANGES_REQUESTED', 'failure'],
  ['Rejected', 'failure'],
  ['queued', 'pending'],
  ['Waiting for author', 'pending'],
  ['No vote', 'neutral'],
  ['notApplicable', 'neutral'],
])('provider state %s renders as %s', (state, tone) => {
  expect(statusTone(state)).toBe(tone);
});
test('Azure system paths display without their leading slash', () => {
  expect(displayPath('/src/app.ts')).toBe('src/app.ts');
  expect(displayPath('src/app.ts')).toBe('src/app.ts');
});
