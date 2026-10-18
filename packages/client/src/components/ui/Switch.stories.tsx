import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Switch } from './switch';
import { Label } from './label';

const meta = {
  title: 'Primitives/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    disabled: { control: 'boolean' },
    size: {
      control: 'select',
      options: ['default', 'sm'],
    },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Small: Story = {
  args: { size: 'sm' },
};

export const SmallChecked: Story = {
  args: { size: 'sm', defaultChecked: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
};

export const WithLabel: Story = {
  render: function SwitchWithLabel() {
    const [on, setOn] = useState(true);
    return (
      <div className="flex items-center gap-2">
        <Switch
          id="dark-mode"
          checked={on}
          onCheckedChange={setOn}
        />
        <Label htmlFor="dark-mode">Dark mode</Label>
      </div>
    );
  },
};

export const SettingsPanel: Story = {
  render: () => {
    const settings = [
      { id: 'dark-mode', label: 'Dark mode', defaultOn: true },
      { id: 'notifications', label: 'Notifications', defaultOn: false },
      { id: 'auto-save', label: 'Auto-save', defaultOn: true },
      { id: 'analytics', label: 'Usage analytics', defaultOn: false },
    ];
    return (
      <div className="flex flex-col gap-4">
        {settings.map((setting) => (
          <SwitchSetting key={setting.id} id={setting.id} label={setting.label} defaultOn={setting.defaultOn} />
        ))}
      </div>
    );
  },
};

function SwitchSetting({ id, label, defaultOn }: { id: string; label: string; defaultOn: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={on} onCheckedChange={setOn} />
    </div>
  );
}
