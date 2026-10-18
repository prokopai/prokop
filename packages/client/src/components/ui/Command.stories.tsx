import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { FileIcon, FolderIcon, GitBranchIcon, SearchIcon, SettingsIcon, TerminalIcon } from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './command';
import { Button } from './button';

/** The cmdk palette used by the tab search and file autocomplete. */

function Palette({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <>
      <CommandInput placeholder="Search files, sessions, commands…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Files">
          <CommandItem value="src/index.ts" onSelect={onSelect}><FileIcon />src/index.ts</CommandItem>
          <CommandItem value="src/components" onSelect={onSelect}><FolderIcon />src/components</CommandItem>
          <CommandItem value="README.md" onSelect={onSelect}><FileIcon />README.md</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="new-terminal" onSelect={onSelect}><TerminalIcon />New terminal<CommandShortcut>⌘`</CommandShortcut></CommandItem>
          <CommandItem value="branches" onSelect={onSelect}><GitBranchIcon />Branches</CommandItem>
          <CommandItem value="settings" onSelect={onSelect}><SettingsIcon />Settings<CommandShortcut>⌘,</CommandShortcut></CommandItem>
          <CommandItem value="disabled" disabled><SearchIcon />Disabled item</CommandItem>
        </CommandGroup>
      </CommandList>
    </>
  );
}

interface Args { onSelect: (value: string) => void }

const meta = {
  title: 'Primitives/Command',
  parameters: { layout: 'centered' },
  args: { onSelect: fn() },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Inline: Story = {
  render: ({ onSelect }) => (
    <Command className="w-96 rounded-lg border shadow-md">
      <Palette onSelect={onSelect} />
    </Command>
  ),
};

export const Empty: Story = {
  render: () => (
    <Command className="w-96 rounded-lg border shadow-md">
      <CommandInput placeholder="Type to search…" value="zzz" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
      </CommandList>
    </Command>
  ),
};

function DialogDemo({ onSelect }: Args) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Open palette</Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Files, sessions and commands">
        <Command>
          <Palette onSelect={(value) => { onSelect(value); setOpen(false); }} />
        </Command>
      </CommandDialog>
    </>
  );
}

export const Dialog: Story = {
  render: (args) => <DialogDemo {...args} />,
};
