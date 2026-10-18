import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Bell, Boxes, Cog, Cpu, GraduationCap, Keyboard, MonitorCog, Palette, Shield } from 'lucide-react';
import { SettingsDialogShell, type SettingsGroup, type SettingsSection } from './SettingsDialogShell';
import { Button } from '@/components/ui/button';

/** The settings dialog frame: grouped section nav, panel area, optional footer. Phones get a two-step layout. */

const sections: SettingsSection[] = [
  { value: 'appearance', label: 'Appearance', icon: Palette, group: 'preferences' },
  { value: 'notifications', label: 'Notifications', icon: Bell, group: 'preferences' },
  { value: 'keybinds', label: 'Keybinds', icon: Keyboard, group: 'preferences' },
  { value: 'workspace-general', label: 'General', icon: Cog, group: 'workspace' },
  { value: 'workspace-permissions', label: 'Permissions', icon: Shield, group: 'workspace' },
  { value: 'workspace-learning', label: 'Memory & Learning', icon: GraduationCap, group: 'workspace' },
  { value: 'mcp', label: 'MCP Servers', icon: Boxes, group: 'server' },
  { value: 'providers-models', label: 'Providers & Models', icon: Cpu, group: 'prokop' },
  { value: 'system', label: 'System', icon: MonitorCog, group: 'system' },
];

const groups: SettingsGroup[] = [
  { key: 'preferences', label: 'Preferences' },
  { key: 'workspace', label: 'Workspace', control: <span className="text-2xs text-muted-foreground">my-project</span> },
  { key: 'server', label: 'Server' },
  { key: 'prokop', label: 'Prokop' },
  { key: 'system' },
];

interface Args { initial: string; footer: boolean; onOpenChange: (open: boolean) => void }

function Harness({ initial, footer, onOpenChange }: Args) {
  const [value, setValue] = useState(initial);
  return (
    <SettingsDialogShell
      open
      onOpenChange={onOpenChange}
      title="Settings"
      description="Preferences, this workspace, and the server."
      sections={sections}
      groups={groups}
      value={value}
      onValueChange={setValue}
      renderPanel={(current) => <div className="p-6 text-sm text-muted-foreground">Panel for <span className="font-mono">{current}</span></div>}
      footer={footer ? <div className="flex justify-end gap-2"><Button variant="ghost" size="sm">Discard</Button><Button size="sm">Save</Button></div> : undefined}
    />
  );
}

const meta = {
  title: 'Dialogs/SettingsDialogShell',
  parameters: { layout: 'fullscreen' },
  args: { initial: 'appearance', footer: false, onOpenChange: fn() },
  render: (args) => <Harness {...args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Default: Story = {};
export const WithFooter: Story = { args: { initial: 'workspace-general', footer: true } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
export const Tablet: Story = { globals: { viewport: { value: 'tablet' } } };
