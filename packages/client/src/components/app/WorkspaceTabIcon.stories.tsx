import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceTabIcon } from './WorkspaceTabIcon';
import { WORKSPACE_VIEW_IDS, type WorkspaceViewId } from '@/stores/workspaceViewStore';

/** The icon for every kind of workspace tab. */

const ids: WorkspaceViewId[] = [...WORKSPACE_VIEW_IDS, 'session:story-server:sess-1', 'file:doc-1', 'prs:story-server:ws-1'];

const meta = {
  title: 'Workspace/WorkspaceTabIcon',
  component: WorkspaceTabIcon,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof WorkspaceTabIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllViews: Story = {
  args: { id: 'sessions' },
  render: () => (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
      {ids.map((id) => <div key={id} className="contents"><WorkspaceTabIcon id={id} /><span className="font-mono text-xs text-muted-foreground">{id}</span></div>)}
    </div>
  ),
};
