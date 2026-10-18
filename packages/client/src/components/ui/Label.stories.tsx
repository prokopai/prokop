import type { Meta, StoryObj } from '@storybook/react-vite';
import { Label } from './label';
import { Input } from './input';
import { Checkbox } from './checkbox';
import { Switch } from './switch';

const meta = {
  title: 'Primitives/Label',
  component: Label,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'Label text' },
};

export const WithInput: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <Label htmlFor="username">Username</Label>
      <Input id="username" placeholder="Enter username" />
    </div>
  ),
};

export const WithCheckbox: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="remember" />
      <Label htmlFor="remember">Remember me</Label>
    </div>
  ),
};

export const WithSwitch: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="airplane" />
      <Label htmlFor="airplane">Airplane mode</Label>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <Label htmlFor="disabled-input">Disabled Field</Label>
      <Input id="disabled-input" disabled defaultValue="Can't edit this" />
    </div>
  ),
};
