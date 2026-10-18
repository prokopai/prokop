import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { FileTree } from './FileTreePierre';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createFileTreeResponse, gitStatusPresets } from '../../../.storybook/mocks/mockGit';

/**
 * The Explorer tree (Pierre web component). Git status colors rows, ignored
 * folders load lazily, right-click opens the action menu.
 */

function Dock({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen w-80 flex-col border-r bg-sidebar text-sidebar-foreground">{children}</div>;
}

const meta: Meta<typeof FileTree> = {
  title: 'Files & Git/FileTreePierre',
  component: FileTree,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: Pierre file tree is a custom element that measures rows; happy-dom has no layout',
  },
  args: { workspaceId: 'ws-1', sdkClient: createFakeSdkClient(), onFileSelect: fn(), onOpenFileEdit: fn(), serverId: 'story-server' },
  decorators: [(Story) => <Dock><Story /></Dock>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithActiveFile: Story = {
  args: { activePath: 'src/auth/session.ts', activeRoot: '' },
};

export const CleanRepository: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitStatus: async () => gitStatusPresets.clean } } }) },
};

export const NotARepository: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitStatus: async () => gitStatusPresets.notARepo } } }) },
};

export const Truncated: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { tree: async () => createFileTreeResponse({ truncated: true }) } } }) },
};

export const EmptyFolder: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { tree: async () => createFileTreeResponse({ paths: [], ignored: [] }) } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { tree: async () => { throw new Error('ENOENT: workspace path is missing'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
