import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { WorkspaceTabSearch } from './WorkspaceTabSearch';
import type { WorkspaceTab } from './workspaceTab';
import type { WorkspaceViewId } from '@/stores/workspaceViewStore';

/** The search button beside a crowded tab strip on phones: a palette over the open tabs. */

const ids = Array.from({ length: 18 }, (_, i) => `session:s:${i}` as WorkspaceViewId);
const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = Object.fromEntries(ids.map((id, i) => [id, {
  label: ['Refactor the auth module', 'Deploy to staging', 'Write README', 'Fix flaky test', 'Explore codebase', 'Plan migration'][i % 6] + ` ${i + 1}`,
  description: i % 2 ? 'my-project' : 'infra',
  status: i === 1 ? 'Needs input' : i === 4 ? 'Running' : undefined,
}]));

const meta = {
  title: 'Workspace/WorkspaceTabSearch',
  component: WorkspaceTabSearch,
  parameters: { layout: 'centered' },
  args: { ids, tabs, onSelect: fn() },
} satisfies Meta<typeof WorkspaceTabSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FewTabs: Story = {
  args: { ids: ids.slice(0, 2) },
};
