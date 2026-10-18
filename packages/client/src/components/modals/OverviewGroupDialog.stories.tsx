import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { OverviewGroupDialog } from './OverviewGroupDialog';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { createAgent } from '../../../.storybook/mocks/mockSidebar';

/** Create or edit an Overview group: name and member workspaces. */

const workspaces = [
  createWorkspace({ id: 'ws-app', name: 'app', path: '/home/user/app' }),
  createWorkspace({ id: 'ws-infra', name: 'infra', path: '/home/user/infra' }),
  createWorkspace({ id: 'ws-docs', name: 'docs', path: '/home/user/docs' }),
  createWorkspace({ id: 'ws-agent', name: 'reviewer', path: '/home/user/.prokopai/agents/reviewer', settings: { isAgentHome: true, agentId: 'agent-1' } }),
];
const agents = [createAgent({ id: 'agent-1', name: 'reviewer' })];
const groups: OverviewGroup[] = [
  { id: 'g-all', serverId: 'story-server', name: 'Everything', workspaceIds: workspaces.map((w) => w.id) },
  { id: 'g-work', serverId: 'story-server', name: 'Work', workspaceIds: ['ws-app', 'ws-infra'] },
];

const meta = {
  title: 'Dialogs/OverviewGroupDialog',
  component: OverviewGroupDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    onOpenChange: fn(),
    mode: 'create',
    serverId: 'story-server',
    groups,
    workspaces,
    agents,
    actions: { createGroup: fn(() => 'g-new'), renameGroup: fn(() => true), setGroupWorkspaces: fn(), deleteGroup: fn() },
    onCreated: fn(),
  },
} satisfies Meta<typeof OverviewGroupDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {};

export const CreateWithPreselected: Story = {
  args: { preselectedWorkspaceId: 'ws-docs' },
};

export const Edit: Story = {
  args: { mode: 'edit', editingGroupId: 'g-work' },
};

export const ManyWorkspaces: Story = {
  args: { workspaces: Array.from({ length: 40 }, (_, i) => createWorkspace({ id: `ws-${i}`, name: `project-${i}`, path: `/home/user/project-${i}` })) },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
