import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { LayoutGridIcon, LayoutListIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { SegmentedControl, type SegmentedOption } from './segmented-control';

/** The one control for picking one of a few short options inline. */

interface Args { onChange: (value: string) => void }

function Demo({ options, initial, size, variant, onChange }: { options: SegmentedOption<string>[]; initial: string; size?: 'default' | 'sm'; variant?: 'track' | 'tabs'; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <SegmentedControl label="Demo" options={options} value={value} size={size} variant={variant} onChange={(next) => { setValue(next); onChange(next); }} />;
}

const meta = {
  title: 'Primitives/SegmentedControl',
  parameters: { layout: 'centered' },
  args: { onChange: fn() },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const WithIcons: Story = {
  render: ({ onChange }) => <Demo initial="dark" onChange={onChange} options={[
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
    { value: 'system', label: 'System', icon: MonitorIcon },
  ]} />,
};

export const TextOnly: Story = {
  render: ({ onChange }) => <Demo initial="open" onChange={onChange} options={[
    { value: 'open', label: 'Open' },
    { value: 'merged', label: 'Merged' },
    { value: 'closed', label: 'Closed' },
    { value: 'all', label: 'All' },
  ]} />,
};

export const Small: Story = {
  render: ({ onChange }) => <Demo initial="workspace" size="sm" onChange={onChange} options={[
    { value: 'workspace', label: 'Workspace', icon: LayoutListIcon },
    { value: 'overview', label: 'Overview', icon: LayoutGridIcon },
  ]} />,
};

/** No track: 28px pills shaped like the dock tab strips, for the title bar. */
export const Tabs: Story = {
  render: ({ onChange }) => <Demo initial="workspace" variant="tabs" onChange={onChange} options={[
    { value: 'workspace', label: 'Workspace', icon: LayoutListIcon },
    { value: 'overview', label: 'Overview', icon: LayoutGridIcon },
  ]} />,
};

export const WithDisabled: Story = {
  render: ({ onChange }) => <Demo initial="source" onChange={onChange} options={[
    { value: 'source', label: 'Source' },
    { value: 'preview', label: 'Preview', disabled: true, title: 'Preview is unavailable for this file' },
  ]} />,
};
