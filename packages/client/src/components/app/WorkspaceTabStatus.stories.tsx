import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceTabStatus } from './WorkspaceTabStatus';

/** The status mark beside a tab label: running pulse or "needs input". */

const meta = {
  title: 'Workspace/WorkspaceTabStatus',
  component: WorkspaceTabStatus,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof WorkspaceTabStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = { args: { status: 'Running' } };
export const NeedsInput: Story = { args: { status: 'Needs input' } };
export const None: Story = { args: { status: undefined } };
