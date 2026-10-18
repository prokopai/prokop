import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { FolderPickerDialog } from './FolderPickerDialog';
import { createFakeSdkClient } from '../../../.storybook/harness';

/** Browse the server's filesystem to pick a folder for a workspace or an additional path. */

const meta = {
  title: 'Dialogs/FolderPickerDialog',
  component: FolderPickerDialog,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: fn(), onSelect: fn(), sdkClient: createFakeSdkClient(), initialPath: '/home/user' },
} satisfies Meta<typeof FolderPickerDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomTitle: Story = {
  args: { title: 'Add a folder the agent may read' },
};

export const AtRoot: Story = {
  args: { initialPath: '/', sdkClient: createFakeSdkClient({ http: { files: { browseFs: async () => ({ files: ['home', 'usr', 'var', 'tmp'].map((name) => ({ name, type: 'directory' as const, path: `/${name}` })), currentPath: '/', mode: 'browse' as const, isRoot: true }) } } }) },
};

export const EmptyFolder: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { browseFs: async (path) => ({ files: [], currentPath: path ?? '/home/user', mode: 'browse' as const, isRoot: false }) } } }) },
};

export const SeveralDrives: Story = {
  args: { initialPath: 'C:\\Users\\me', sdkClient: createFakeSdkClient({ http: { files: { drives: async () => ({ drives: ['C:\\', 'D:\\', 'E:\\'] }), browseFs: async (path) => ({ files: ['Documents', 'Projects'].map((name) => ({ name, type: 'directory' as const, path: `${path ?? 'C:\\Users\\me'}\\${name}` })), currentPath: path ?? 'C:\\Users\\me', mode: 'browse' as const, isRoot: false }) } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { browseFs: async () => { throw new Error('EACCES: permission denied'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
