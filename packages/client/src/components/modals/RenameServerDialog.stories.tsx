import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { RenameServerDialog } from './RenameServerDialog';
import { storyServer } from '../../../.storybook/harness';

/** Rename a saved machine. */

const meta = {
  title: 'Dialogs/RenameServerDialog',
  component: RenameServerDialog,
  parameters: { layout: 'fullscreen' },
  args: { server: storyServer, open: true, onOpenChange: fn(), onRename: fn((_id: string, name: string): string | null => name) },
} satisfies Meta<typeof RenameServerDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RenameRejected: Story = {
  args: { onRename: fn((_id: string, _name: string): string | null => null) },
};

export const NoServer: Story = {
  args: { server: null },
};
