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

export const Indeterminate: Story = {
  args: { checked: 'indeterminate' },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true },
};

/** Every state side by side, in the small size the file list uses and the default size the options use. */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['size-4', 'size-3.5'] as const).map((size) => (
        <div key={size} className="flex items-center gap-4">
          <Checkbox className={size} aria-label="Unchecked" />
          <Checkbox className={size} aria-label="Checked" defaultChecked />
          <Checkbox className={size} aria-label="Indeterminate" checked="indeterminate" />
          <Checkbox className={size} aria-label="Disabled checked" disabled defaultChecked />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox className={size} defaultChecked />
            Run commit hooks
          </label>
        </div>
      ))}
    </div>
  ),
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
