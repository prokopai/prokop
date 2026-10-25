import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { FileActionsDialogs } from './FileActionsDialogs';

/** Create, rename and delete dialogs for the file tree. */

const target = { path: 'src/auth/session.ts', isDirectory: false, name: 'session.ts' };
const folder = { path: 'src/auth', isDirectory: true, name: 'auth' };

const meta = {
  title: 'Files & Git/FileActionsDialogs',
  component: FileActionsDialogs,
  parameters: { layout: 'centered' },
  args: {
    dialog: { type: 'create', parentDirPath: 'src/auth', kind: 'file' },
    mutating: false,
    error: null,
    overwrite: false,
    renameConflict: false,
    onClose: fn(),
    submitCreate: fn(),
    submitRename: fn(),
    submitDelete: fn(),
    setOverwrite: fn(),
  },
} satisfies Meta<typeof FileActionsDialogs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreateFile: Story = {};

export const CreateFolder: Story = {
  args: { dialog: { type: 'create', parentDirPath: 'src', kind: 'directory' } },
};

export const CreateAtRoot: Story = {
  args: { dialog: { type: 'create', parentDirPath: '', kind: 'file' } },
};

export const CreateWithError: Story = {
  args: { error: 'A file named session.ts already exists.' },
};

export const Rename: Story = {
  args: { dialog: { type: 'rename', target } },
};

export const RenameConflict: Story = {
  args: { dialog: { type: 'rename', target }, renameConflict: true, error: 'The target exists. Overwrite it?' },
};

export const RenameOverwriteChecked: Story = {
  args: { dialog: { type: 'rename', target }, renameConflict: true, overwrite: true },
};

/** Pick where a file goes; the folders matching what is typed are offered. */
export const Move: Story = {
  args: { dialog: { type: 'move', target }, submitMove: fn(), workspaceId: 'ws', sdkClient: null },
};

export const MoveFolderWithError: Story = {
  args: { dialog: { type: 'move', target: folder }, submitMove: fn(), workspaceId: 'ws', sdkClient: null, error: 'A folder cannot be moved into itself' },
};

export const DeleteFile: Story = {
  args: { dialog: { type: 'delete', target } },
};

export const DeleteFolder: Story = {
  args: { dialog: { type: 'delete', target: folder } },
};

export const Mutating: Story = {
  args: { dialog: { type: 'delete', target }, mutating: true },
};

export const Closed: Story = {
  args: { dialog: null },
};
