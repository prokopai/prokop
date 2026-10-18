import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { WorkspaceAdditionalPathsDialog } from './WorkspaceAdditionalPathsDialog';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';

/** Edit the extra folders of a workspace from the workspace switcher. */

const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project', additionalPaths: ['/home/user/my-project-docs'] });

const meta = {
  title: 'Dialogs/WorkspaceAdditionalPathsDialog',
  component: WorkspaceAdditionalPathsDialog,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: fn(), workspace, onSave: fn(), sdkClient: createFakeSdkClient() },
} satisfies Meta<typeof WorkspaceAdditionalPathsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoPaths: Story = { args: { workspace: { ...workspace, additionalPaths: [] } } };
export const Saving: Story = { args: { isSaving: true } };
export const Offline: Story = { args: { sdkClient: null } };
