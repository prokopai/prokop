import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PencilIcon, TrashIcon } from 'lucide-react';
import { SettingsEditorHeader, SettingsEmpty, SettingsError, SettingsListRow, SettingsLoading } from './SettingsPrimitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** The rows, headers and states every settings panel is built from. */

const meta = {
  title: 'Settings/SettingsPrimitives',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background"><Story /></div>],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ListRows: Story = {
  render: () => (
    <div className="flex flex-col">
      <SettingsListRow title="Code reviewer" description="Reviews pull requests and leaves findings." onOpen={fn()} badges={<Badge variant="secondary">default</Badge>} meta={<span className="text-xs text-muted-foreground">3 tools</span>} actions={<><Button variant="ghost" size="icon-xs" aria-label="Edit"><PencilIcon /></Button><Button variant="ghost" size="icon-xs" aria-label="Delete"><TrashIcon /></Button></>} />
      <SettingsListRow title="Explorer" description="Read-only agent for mapping a codebase before changes, with a description long enough to be truncated at one line." onOpen={fn()} />
      <SettingsListRow title="No description" onOpen={fn()} meta={<span className="text-xs text-muted-foreground">paused</span>} />
    </div>
  ),
};

export const EditorHeader: Story = {
  render: () => (
    <div className="flex flex-col gap-4 p-3">
      <SettingsEditorHeader title="Code reviewer" backLabel="Agents" onBack={fn()} onSave={fn()} saving={false} canSave />
      <SettingsEditorHeader title="Unchanged draft" backLabel="Agents" onBack={fn()} onSave={fn()} saving={false} canSave={false} />
      <SettingsEditorHeader title="Saving" backLabel="Agents" onBack={fn()} onSave={fn()} saving canSave />
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4 p-3">
      <SettingsLoading />
      <SettingsEmpty>No prompts yet. Add one to reuse text in the composer.</SettingsEmpty>
      <SettingsError>Could not load agents: Provider returned 503.</SettingsError>
    </div>
  ),
};
