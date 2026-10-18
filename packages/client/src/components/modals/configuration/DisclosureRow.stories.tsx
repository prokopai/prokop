import type { Meta, StoryObj } from '@storybook/react-vite';
import { DisclosureRow } from './DisclosureRow';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** A collapsible settings row with a value recap on the trigger. */

const body = (
  <div className="flex flex-col gap-2 p-3">
    <Label htmlFor="disclosure-input">Idle minutes</Label>
    <Input id="disclosure-input" defaultValue="30" className="w-32" />
  </div>
);

const meta = {
  title: 'Settings/DisclosureRow',
  component: DisclosureRow,
  parameters: { layout: 'padded' },
  args: { label: 'Cadence', summary: 'Every 30 min after idle', children: body },
  decorators: [(Story) => <div className="w-[32rem] rounded-xl border bg-card"><Story /></div>],
} satisfies Meta<typeof DisclosureRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSummary: Story = {};

export const NoSummary: Story = {
  args: { summary: null },
};

export const Bordered: Story = {
  args: { bordered: true },
  render: (args) => <><DisclosureRow {...args} /><DisclosureRow {...args} label="Sources" summary="All workspaces" /></>,
};

export const ClosedByDefault: Story = {
  args: { defaultOpen: false },
};
