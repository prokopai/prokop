import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Checkbox } from './checkbox';
import { Label } from './label';

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true },
};

export const WithLabel: Story = {
  render: function WithLabelRender() {
    const [checked, setChecked] = useState(false);
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id="terms"
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
        />
        <Label htmlFor="terms">Accept terms and conditions</Label>
      </div>
    );
  },
};

export const CheckboxGroup: Story = {
  render: () => {
    const items = [
      { id: 'notifications', label: 'Email notifications' },
      { id: 'marketing', label: 'Marketing emails' },
      { id: 'security', label: 'Security alerts' },
      { id: 'updates', label: 'Product updates' },
    ];
    return (
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <Checkbox id={item.id} />
            <Label htmlFor={item.id}>{item.label}</Label>
          </div>
        ))}
      </div>
    );
  },
};
