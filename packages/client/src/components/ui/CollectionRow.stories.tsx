import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { Globe, Terminal } from 'lucide-react';
import { CollectionRow, RowTile } from './collection-row';
import { SettingsGroup } from './settings-group';
import { SettingsRow } from './settings-row';
import { Switch } from './switch';
import { Button } from './button';
import { ProviderTile } from '@/components/branding/ProviderTile';

/** One thing per row; details open underneath; controls at the right stay clickable. */

const meta = {
  title: 'Primitives/CollectionRow',
  component: CollectionRow,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[36rem]"><SettingsGroup><Story /></SettingsGroup></div>],
} satisfies Meta<typeof CollectionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Prokop Visuals',
    status: 'Connected · Lets agents show charts, tables and diagrams as pages in their replies.',
    icon: <RowTile><Globe /></RowTile>,
    actions: <Switch defaultChecked aria-label="Enable Prokop Visuals" />,
  },
};

function ExpandableDemo(args: ComponentProps<typeof CollectionRow>) {
  const [open, setOpen] = useState(true);
  return (
    <CollectionRow {...args} expanded={open} onToggle={() => setOpen(!open)} actions={<Switch defaultChecked aria-label="Enable github" />}>
      <SettingsRow label="Command" description="npx -y @modelcontextprotocol/server-github" />
      <SettingsRow label="Tools" description="12 of 14 allowed"><Button variant="outline" size="xs">Choose tools</Button></SettingsRow>
    </CollectionRow>
  );
}

export const Expandable: Story = {
  args: { title: 'github', status: 'Connected · Local command', icon: <RowTile><Terminal /></RowTile> },
  render: (args) => <ExpandableDemo {...args} />,
};

export const WithBrand: Story = {
  args: {
    title: 'DeepSeek',
    status: 'Configured · 3 models',
    icon: <ProviderTile provider="deepseek" name="DeepSeek" />,
    onToggle: () => {},
  },
};

export const NoIcon: Story = {
  args: { title: 'linear', status: <span className="text-error">Connection failed · spawn linear ENOENT</span>, onToggle: () => {}, actions: <Switch aria-label="Enable linear" /> },
};
