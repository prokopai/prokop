import type { Meta, StoryObj } from '@storybook/react-vite';
import { Separator } from './separator';

const meta = {
  title: 'Primitives/Separator',
  component: Separator,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    orientation: {
      control: 'select',
      options: ['horizontal', 'vertical'],
    },
  },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-64">
      <p className="text-sm">Content above</p>
      <Separator className="my-4" />
      <p className="text-sm">Content below</p>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-4">
      <span className="text-sm">Item 1</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Item 2</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Item 3</span>
    </div>
  ),
};

export const InCard: Story = {
  render: () => (
    <div className="w-80 rounded-lg border p-4">
      <h3 className="text-sm font-medium">Team</h3>
      <p className="text-sm text-muted-foreground">Manage your team members.</p>
      <Separator className="my-4" />
      <div className="flex items-center gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Members</span>
          <span className="text-xs text-muted-foreground">Invite your team members.</span>
        </div>
        <Separator orientation="vertical" className="h-8" />
        <div className="flex flex-col">
          <span className="text-sm font-medium">Roles</span>
          <span className="text-xs text-muted-foreground">Manage permissions.</span>
        </div>
      </div>
    </div>
  ),
};
