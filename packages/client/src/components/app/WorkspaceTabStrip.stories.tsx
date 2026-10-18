import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { MoreHorizontalIcon } from 'lucide-react';
import { WorkspaceTabStrip } from './WorkspaceTabStrip';
import type { WorkspaceTab } from './workspaceTab';
import type { WorkspaceViewId } from '@/stores/workspaceViewStore';
import { Button } from '@/components/ui/button';

/** Tabs of one dock group: tool views, sessions, files and pull requests, with status, dirty dot and close. */

const ids: WorkspaceViewId[] = ['sessions', 'session:s:a', 'session:s:b', 'file:doc-1', 'file:doc-2', 'prs:s:ws', 'explorer', 'terminals'];
const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = {
  'session:s:a': { label: 'Refactor the auth module', status: 'Running' },
  'session:s:b': { label: 'Deploy to staging', status: 'Needs input' },
  'file:doc-1': { label: 'session.ts', description: 'my-project · src/auth/session.ts', dirty: true },
  'file:doc-2': { label: 'README.md', description: 'my-project · README.md', closeDisabled: true },
  'prs:s:ws': { label: 'Pull requests · my-project' },
};

const meta = {
  title: 'Workspace/WorkspaceTabStrip',
  component: WorkspaceTabStrip,
  parameters: { layout: 'padded' },
  args: { ids, activeId: 'session:s:a', tabs, label: 'Center views', onSelect: fn(), onClose: fn(), onMove: fn() },
  decorators: [(Story) => <div className="flex h-10 w-[48rem] items-center rounded-t-xl border bg-sidebar px-1 text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof WorkspaceTabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTabMenu: Story = {
  args: {
    renderTabMenu: (_id, trigger) => (
      <span className="flex items-center gap-0.5">
        {trigger}
        <Button variant="ghost" size="icon-xs" aria-label="Tab menu"><MoreHorizontalIcon /></Button>
      </span>
    ),
  },
};

export const ToolViewsOnly: Story = {
  args: { ids: ['sessions', 'explorer', 'changes', 'branches', 'worktrees', 'terminals', 'usage'], activeId: 'explorer' },
};

export const Overflowing: Story = {
  args: {
    ids: Array.from({ length: 24 }, (_, i) => `file:doc-${i}` as WorkspaceViewId),
    tabs: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`file:doc-${i}`, { label: `file-${i}.ts` }])),
    activeId: 'file:doc-5',
  },
};

export const Phone: Story = {
  decorators: [(Story) => <div className="flex h-10 w-full items-center bg-sidebar px-1"><Story /></div>],
  globals: { viewport: { value: 'phone' } },
};
