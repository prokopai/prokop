import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderIcon, GitBranchIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { DockHeader } from './dock-header';
import { SectionLabel } from './section-label';
import { Button } from './button';

/** The row at the top of every dock and panel: one height, optional hairline. */

function Dock({ children }: { children: React.ReactNode }) {
  return <div className="flex h-48 w-80 flex-col overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground">{children}<div className="flex-1 p-3 text-xs text-muted-foreground">content</div></div>;
}

const meta = {
  title: 'Primitives/DockHeader',
  component: DockHeader,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof DockHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Label: Story = {
  render: () => (
    <Dock>
      <DockHeader className="justify-between">
        <SectionLabel>Worktrees</SectionLabel>
        <Button variant="ghost" size="icon-xs" aria-label="New"><PlusIcon /></Button>
      </DockHeader>
    </Dock>
  ),
};

export const Picker: Story = {
  render: () => (
    <Dock>
      <DockHeader className="justify-between">
        <Button variant="ghost" className="gap-1.5 px-2 font-semibold"><FolderIcon className="size-4" />my-project</Button>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" aria-label="Refresh"><RefreshCwIcon /></Button>
          <Button variant="ghost" size="icon" aria-label="New file"><PlusIcon /></Button>
        </div>
      </DockHeader>
    </Dock>
  ),
};

export const WithDivider: Story = {
  render: () => (
    <Dock>
      <DockHeader divider>
        <GitBranchIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">feature/login</span>
        <Button variant="ghost" className="ml-auto">Push…</Button>
      </DockHeader>
    </Dock>
  ),
};
