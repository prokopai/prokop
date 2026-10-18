import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { GitChangesView } from './GitChangesView';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { gitStatusPresets } from '../../../.storybook/mocks/mockGit';

/** The Changes view: working-tree status as a tree, with commit and push below. */

function Dock({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen w-80 flex-col border-r bg-sidebar text-sidebar-foreground">{children}</div>;
}

const meta: Meta<typeof GitChangesView> = {
  title: 'Files & Git/GitChangesView',
  component: GitChangesView,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: Pierre file tree is a custom element that measures rows; happy-dom has no layout',
  },
  args: { workspaceId: 'ws-1', sdkClient: createFakeSdkClient(), serverId: 'story-server', onFileSelect: fn(), onOpenFileEdit: fn() },
  decorators: [(Story) => <Dock><Story /></Dock>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithChanges: Story = {};

export const Clean: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitStatus: async () => gitStatusPresets.clean } } }) },
};

export const Conflicted: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitStatus: async () => gitStatusPresets.conflicted } } }) },
};

export const NotARepository: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitStatus: async () => gitStatusPresets.notARepo } } }) },
};

export const GitMissing: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitStatus: async () => gitStatusPresets.gitMissing } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitStatus: async () => { throw new Error('git status timed out'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
