import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorktreesPanel } from './WorktreesPanel';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createWorktree, worktreePresets } from '../../../.storybook/mocks/mockWorktree';

/** Managed worktrees of the workspace: list, create, open in the explorer, remove. */

function Dock({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen w-80 flex-col border-r bg-sidebar text-sidebar-foreground">{children}</div>;
}

function clientWith(worktrees: ReturnType<typeof createWorktree>[], latencyMs = 0) {
  return createFakeSdkClient({ latencyMs, http: { workspaces: { listWorktrees: async () => ({ worktrees }) } } });
}

const meta = {
  title: 'Files & Git/WorktreesPanel',
  component: WorktreesPanel,
  parameters: { layout: 'fullscreen' },
  args: { sdkClient: createFakeSdkClient(), workspaceId: 'ws-1' },
  decorators: [(Story) => <Dock><Story /></Dock>],
} satisfies Meta<typeof WorktreesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllStates: Story = {
  args: { sdkClient: clientWith(Object.values(worktreePresets)) },
};

export const Many: Story = {
  args: { sdkClient: clientWith(Array.from({ length: 50 }, (_, i) => createWorktree({ name: `task-${i + 1}`, branch: `task/${i + 1}-${['login', 'refresh', 'docs', 'ci'][i % 4]}`, dirty: i % 3 === 0 }))) },
};

export const Empty: Story = {
  args: { sdkClient: clientWith([]) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { workspaces: { listWorktrees: async () => { throw new Error('Worktrees are unavailable for this workspace'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
