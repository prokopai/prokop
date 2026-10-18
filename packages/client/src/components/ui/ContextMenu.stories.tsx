import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu';

/** Right-click menus: file tree rows, terminal tabs, session rows. */

function Target() {
  return (
    <div className="flex h-40 w-80 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      Right-click here
    </div>
  );
}

interface Args { onSelect: () => void }

const meta = {
  title: 'Primitives/ContextMenu',
  parameters: { layout: 'centered' },
  args: { onSelect: fn() },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Default: Story = {
  render: ({ onSelect }) => (
    <ContextMenu>
      <ContextMenuTrigger asChild><Target /></ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={onSelect}>Open<ContextMenuShortcut>↵</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={onSelect}>Open to the side</ContextMenuItem>
        <ContextMenuItem onSelect={onSelect}>Reveal in explorer</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onSelect}>Rename<ContextMenuShortcut>F2</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={onSelect}>Delete<ContextMenuShortcut>⌫</ContextMenuShortcut></ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

function SubmenuDemo({ onSelect }: Args) {
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState('name');
  return (
      <ContextMenu>
        <ContextMenuTrigger asChild><Target /></ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>src/components</ContextMenuLabel>
          <ContextMenuItem onSelect={onSelect}>New file</ContextMenuItem>
          <ContextMenuItem onSelect={onSelect}>New folder</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Copy</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-44">
              <ContextMenuItem onSelect={onSelect}>Path</ContextMenuItem>
              <ContextMenuItem onSelect={onSelect}>Relative path</ContextMenuItem>
              <ContextMenuItem onSelect={onSelect}>Name</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem checked={showHidden} onCheckedChange={setShowHidden}>Show hidden files</ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuRadioGroup value={sort} onValueChange={setSort}>
            <ContextMenuLabel>Sort by</ContextMenuLabel>
            <ContextMenuRadioItem value="name">Name</ContextMenuRadioItem>
            <ContextMenuRadioItem value="modified">Last modified</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>
  );
}

export const WithSubmenuAndToggles: Story = {
  render: (args) => <SubmenuDemo {...args} />,
};
