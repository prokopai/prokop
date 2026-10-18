import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { OverviewGroupSelector } from './OverviewGroupSelector';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { createAgent } from '../../../.storybook/mocks/mockSidebar';

/** Picks which workspaces the Overview shows, and manages the saved groups. */

const workspaces = [
  createWorkspace({ id: 'ws-app', name: 'app', path: '/home/user/app' }),
  createWorkspace({ id: 'ws-infra', name: 'infra', path: '/home/user/infra' }),
  createWorkspace({ id: 'ws-docs', name: 'docs', path: '/home/user/docs' }),
  createWorkspace({ id: 'ws-agent', name: 'reviewer home', path: '/home/user/.prokopai/agents/reviewer', settings: { isAgentHome: true, agentId: 'agent-1' } }),
];
const agents = [createAgent({ id: 'agent-1', name: 'reviewer' })];
const groups = [
  { id: 'g-all', serverId: 'story-server', name: 'Everything', workspaceIds: workspaces.map((w) => w.id) },
  { id: 'g-work', serverId: 'story-server', name: 'Work', workspaceIds: ['ws-app', 'ws-infra'] },
  { id: 'g-docs', serverId: 'story-server', name: 'Docs only', workspaceIds: ['ws-docs'] },
] as unknown as Parameters<typeof OverviewGroupSelector>[0]['groups'];

const actions = {
  selectGroup: fn(),
  createGroup: fn(() => 'g-new'),
  renameGroup: fn(() => true),
  setGroupWorkspaces: fn(),
  deleteGroup: fn(),
};

const meta = {
  title: 'Sessions/OverviewGroupSelector',
  component: OverviewGroupSelector,
  parameters: { layout: 'padded' },
  args: { serverId: 'story-server', groups, activeGroup: groups[1] ?? null, workspaces, agents, isHydrated: true, actions },
  decorators: [(Story) => <div className="w-80 rounded-xl border bg-sidebar p-2 text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof OverviewGroupSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoActiveGroup: Story = {
  args: { activeGroup: null },
};

export const NoGroups: Story = {
  args: { groups: [], activeGroup: null },
};

export const Hydrating: Story = {
  args: { isHydrated: false },
};

export const ManyWorkspaces: Story = {
  args: { workspaces: Array.from({ length: 30 }, (_, i) => createWorkspace({ id: `ws-${i}`, name: `project-${i}`, path: `/home/user/project-${i}` })) },
};
