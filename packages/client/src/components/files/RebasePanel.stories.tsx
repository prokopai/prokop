import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { RebasePanel } from './RebasePanel';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createBranches, rebasePresets } from '../../../.storybook/mocks/mockGit';

/**
 * Local-only rebase from the Branches view: choose a base, start, resolve
 * conflicts one file at a time, continue or abort.
 */

function Dock({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen w-[22rem] flex-col border-r bg-sidebar text-sidebar-foreground">{children}</div>;
}

const meta = {
  title: 'Files & Git/RebasePanel',
  component: RebasePanel,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: the conflict editor is a Pierre custom element; happy-dom has no layout',
  },
  args: {
    sdkClient: createFakeSdkClient(),
    serverId: 'story-server',
    workspaceId: 'ws-1',
    branches: createBranches(),
    onClose: fn(),
    onChanged: fn(),
  },
  decorators: [(Story) => <Dock><Story /></Dock>],
} satisfies Meta<typeof RebasePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChooseBase: Story = {};

export const WithConflicts: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitRebaseState: async () => rebasePresets.conflicts } } }) },
};

export const AllResolved: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitRebaseState: async () => rebasePresets.resolved } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitRebaseState: async () => { throw new Error('fatal: not a git repository'); } } } }) },
};

export const BranchesUnknown: Story = {
  args: { branches: undefined },
};
