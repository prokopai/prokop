import type { Meta, StoryObj } from '@storybook/react-vite';
import { PullRequestDetailView } from './PullRequestDetailView';
import { usePrDrafts, type PullRequestContext } from './shared';
import { createFakeSdkClient, type FakeHttp } from '../../../.storybook/harness';
import { createPullRequestDetail, createPullRequestSummary } from '../../../.storybook/mocks/mockGit';

/**
 * One pull request: description, reviewers, checks, threads, review form,
 * files, and the merge box. The fake server answers detail, files and
 * patch; actions log to the Actions panel and resolve.
 */

function ctx(http: FakeHttp = {}, overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    client: createFakeSdkClient({ http: { pullRequests: { action: async () => ({ ok: true }), ...http.pullRequests }, ...http } }),
    serverId: 'story-server',
    workspaceId: 'ws-1',
    scope: { remote: 'origin', repositoryKey: 'github:acme/app' },
    accountId: 'acct-1',
    provider: 'github',
    ...overrides,
  };
}

function detailCtx(detail: Partial<Parameters<typeof createPullRequestDetail>[0]>, overrides?: Partial<PullRequestContext>) {
  return ctx({ pullRequests: { detail: async () => createPullRequestDetail(detail) } }, overrides);
}

const meta = {
  title: 'Files & Git/PullRequestDetailView',
  component: PullRequestDetailView,
  parameters: { layout: 'fullscreen' },
  args: { ctx: ctx(), number: 7, visible: true },
  decorators: [(Story) => { usePrDrafts.setState({ values: {} }); return <div className="@container h-screen overflow-auto bg-background p-3"><Story /></div>; }],
} satisfies Meta<typeof PullRequestDetailView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenMergeable: Story = {};

export const Draft: Story = {
  args: { ctx: detailCtx({ draft: true, reviewers: [], checks: [] }) },
};

export const Conflicting: Story = {
  args: { ctx: detailCtx({ mergeability: 'conflicting', warnings: ['This branch has conflicts that must be resolved.'] }) },
};

export const ChecksPending: Story = {
  args: { ctx: detailCtx({ checks: [{ name: 'build', state: 'pending' }, { name: 'test', state: 'pending' }], reviewers: [{ id: 'alice', name: 'Alice', vote: 'wait' }] }) },
};

export const ChangesRequested: Story = {
  args: { ctx: detailCtx({ reviewers: [{ id: 'alice', name: 'Alice', vote: 'request-changes' }], mergeability: 'unknown' }) },
};

export const AutoMergeEnabled: Story = {
  args: { ctx: detailCtx({ autoMerge: true }) },
};

export const Merged: Story = {
  args: { ctx: detailCtx({ state: 'merged', mergeMethods: [] }) },
};

export const Closed: Story = {
  args: { ctx: detailCtx({ state: 'closed', mergeMethods: [] }) },
};

export const ManyThreads: Story = {
  args: {
    ctx: detailCtx({
      threads: Array.from({ length: 12 }, (_, i) => ({
        id: `t${i}`, path: i % 2 ? 'src/auth/session.ts' : 'src/auth/refresh.ts', line: 4 + i, side: 'RIGHT' as const, resolved: i % 3 === 0, outdated: i % 4 === 0, canResolve: true,
        comments: [{ id: `c${i}`, author: { id: 'alice', name: 'Alice' }, body: `Comment number ${i + 1} on this line.`, createdAt: new Date(Date.now() - i * 3_600_000).toISOString() }],
      })),
    }),
  },
};

export const Azure: Story = {
  args: { ctx: detailCtx({ iteration: 3, mergeMethods: ['squash', 'rebase-merge'] }, { provider: 'azure', scope: { remote: 'origin', repositoryKey: 'azure:org/project/app' } }) },
};

export const LoadingWithSummary: Story = {
  args: { ctx: ctx({ pullRequests: { detail: () => new Promise(() => {}) } }), summary: createPullRequestSummary() },
};

export const LoadingWithoutSummary: Story = {
  args: { ctx: ctx({ pullRequests: { detail: () => new Promise(() => {}) } }) },
};

export const Failed: Story = {
  args: { ctx: ctx({ pullRequests: { detail: async () => { throw new Error('GitHub returned 403: rate limit exceeded'); } } }) },
};

export const ActionFails: Story = {
  args: { ctx: ctx({ pullRequests: { action: async () => { throw new Error('Merge blocked: required status check "test" is failing.'); } } }) },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
