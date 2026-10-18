import type { Meta, StoryObj } from '@storybook/react-vite';
import { BranchesPanel } from './BranchesPanel';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createBranches, createBranch, createHistory, createGitRepository, rebasePresets } from '../../../.storybook/mocks/mockGit';

/**
 * The Branches view of the Git workbench: local and remote refs, history of
 * the chosen ref, commit details, fetch, create and switch, push review.
 */

function Dock({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen w-[22rem] flex-col border-r bg-sidebar text-sidebar-foreground">{children}</div>;
}

const meta = {
  title: 'Files & Git/BranchesPanel',
  component: BranchesPanel,
  parameters: { layout: 'fullscreen' },
  args: { sdkClient: createFakeSdkClient(), serverId: 'story-server', workspaceId: 'ws-1' },
  decorators: [(Story) => <Dock><Story /></Dock>],
} satisfies Meta<typeof BranchesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NeverFetched: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitBranches: async () => createBranches({ lastFetchedAt: null }) } } }) },
};

export const DetachedHead: Story = {
  args: {
    sdkClient: createFakeSdkClient({
      http: {
        files: {
          gitBranches: async () => createBranches({
            repository: createGitRepository({ branch: null, upstream: null }),
            branches: [createBranch({ name: 'main' }), createBranch({ name: 'origin/main', kind: 'remote' })],
          }),
        },
      },
    }),
  },
};

export const NoRemotes: Story = {
  args: {
    sdkClient: createFakeSdkClient({
      http: {
        files: {
          gitBranches: async () => createBranches({
            repository: createGitRepository({ remotes: [], upstream: null }),
            lastFetchedAt: null,
            branches: [createBranch({ name: 'main', current: true, checkedOut: true, upstream: null, ahead: null, behind: null })],
          }),
        },
      },
    }),
  },
};

export const LongHistory: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitHistory: async () => createHistory(60, { nextOffset: 60 }) } } }) },
};

export const RebaseInProgress: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitRebaseState: async () => rebasePresets.conflicts } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitBranches: async () => { throw new Error('fatal: not a git repository'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
