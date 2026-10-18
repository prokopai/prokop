import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceOrderControl } from './WorkspaceOrderControl';
import { withUIStore } from '../../../.storybook/mocks/storeDecorators';

/** Sorts the workspace switcher: a select in settings, an icon menu in the header. */

const meta = {
  title: 'Sessions/WorkspaceOrderControl',
  component: WorkspaceOrderControl,
  parameters: { layout: 'centered' },
  decorators: [withUIStore()],
} satisfies Meta<typeof WorkspaceOrderControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Select: Story = {};
export const Compact: Story = { args: { compact: true } };
