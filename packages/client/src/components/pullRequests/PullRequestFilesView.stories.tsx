import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import PullRequestFilesView from './PullRequestFilesView';
import { usePrDrafts, type PullRequestContext } from './shared';
import { createFakeSdkClient, type FakeHttp } from '../../../.storybook/harness';
import { createPullRequestDetail, createPullRequestFiles } from '../../../.storybook/mocks/mockGit';

/** Changed files of a pull request: list with viewed state, one file's patch at a time. */

function ctx(http: FakeHttp = {}): PullRequestContext {
  return {
    client: createFakeSdkClient({ http }),
    serverId: 'story-server',
    workspaceId: 'ws-1',
    scope: { remote: 'origin', repositoryKey: 'github:acme/app' },
    accountId: 'acct-1',
    provider: 'github',
  };
}

const pr = createPullRequestDetail();

const meta = {
  title: 'Files & Git/PullRequestFilesView',
  component: PullRequestFilesView,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: the patch renders through a Pierre custom element; happy-dom has no layout',
  },
  args: { ctx: ctx(), pr, act: fn(async () => {}), busy: false },
  decorators: [(Story) => { usePrDrafts.setState({ values: {} }); return <div className="@container h-screen overflow-auto bg-background p-3"><Story /></div>; }],
} satisfies Meta<typeof PullRequestFilesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ManyFiles: Story = {
  args: {
    ctx: ctx({
      pullRequests: {
        files: async () => createPullRequestFiles({
          files: Array.from({ length: 60 }, (_, i) => ({ path: `src/module-${i % 6}/file-${i}.ts`, status: i % 7 === 0 ? 'added' : 'modified', additions: i, deletions: i % 3 })),
        }),
      },
    }),
  },
};

export const Truncated: Story = {
  args: { ctx: ctx({ pullRequests: { files: async () => createPullRequestFiles({ truncated: true }) } }) },
};

export const PatchUnavailable: Story = {
  args: { ctx: ctx({ pullRequests: { patch: async () => ({ patch: '', unavailable: 'The provider did not return a diff for this file (binary or too large).' }) } }) },
};

export const Busy: Story = {
  args: { busy: true },
};

export const Loading: Story = {
  args: { ctx: ctx({ pullRequests: { files: () => new Promise(() => {}) } }) },
};

export const Failed: Story = {
  args: { ctx: ctx({ pullRequests: { files: async () => { throw new Error('GitHub returned 502'); } } }) },
};
