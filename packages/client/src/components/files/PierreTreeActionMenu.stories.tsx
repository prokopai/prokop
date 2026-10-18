import { useLayoutEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { ContextMenuItem, ContextMenuOpenContext } from '@pierre/trees';
import { PierreTreeActionMenu, type PierreTreeActionMenuActions } from './PierreTreeActionMenu';

/**
 * The right-click menu for a tree row. Pierre hands over the row and an
 * anchor; the menu decides which actions apply (deleted rows only preview
 * and copy, untracked rows offer "Add to Git", and so on).
 */

const actions: PierreTreeActionMenuActions = {
  openPreview: fn(),
  openEdit: fn(),
  copyRelative: fn(),
  copyAbsolute: fn(),
  rename: fn(),
  del: fn(),
  createFile: fn(),
  createFolder: fn(),
  addToGit: fn(),
  removeStagedAddition: fn(),
  revertModified: fn(),
};

interface Args {
  item: ContextMenuItem;
  deletedPaths?: ReadonlySet<string>;
  untrackedPaths?: ReadonlySet<string>;
  stagedAdditionPaths?: ReadonlySet<string>;
  modifiedPaths?: ReadonlySet<string>;
  addingToGit?: boolean;
}

function Anchored({ item, addingToGit, ...sets }: Args) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<ContextMenuOpenContext | null>(null);
  useLayoutEffect(() => {
    const element = anchorRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setContext({
      anchorElement: element,
      anchorRect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height, x: rect.x, y: rect.y },
      close: fn(),
      restoreFocus: fn(),
    } as ContextMenuOpenContext);
  }, []);
  return (
    <div className="h-80 w-80 rounded-xl border bg-sidebar p-2 text-sidebar-foreground">
      <div ref={anchorRef} className="rounded-md bg-accent px-2 py-1 text-sm">{item.name}</div>
      {context && <PierreTreeActionMenu item={item} context={context} actions={{ ...actions, addingToGit }} {...sets} />}
    </div>
  );
}

const file: ContextMenuItem = { kind: 'file', name: 'session.ts', path: 'src/auth/session.ts' };
const folder: ContextMenuItem = { kind: 'directory', name: 'auth', path: 'src/auth' };

const meta = {
  title: 'Files & Git/PierreTreeActionMenu',
  parameters: { layout: 'centered' },
  args: { item: file },
  render: (args) => <Anchored {...args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const File: Story = {};

export const Folder: Story = {
  args: { item: folder },
};

export const UntrackedFile: Story = {
  args: { untrackedPaths: new Set([file.path]) },
};

export const AddingToGit: Story = {
  args: { untrackedPaths: new Set([file.path]), addingToGit: true },
};

export const StagedAddition: Story = {
  args: { stagedAdditionPaths: new Set([file.path]) },
};

export const ModifiedFile: Story = {
  args: { modifiedPaths: new Set([file.path]) },
};

export const DeletedFile: Story = {
  args: { deletedPaths: new Set([file.path]) },
};
