import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { createAgent } from '../../../.storybook/mocks/mockSidebar';
import { withUIStore } from '../../../.storybook/mocks/storeDecorators';
import { createFakeSdkClient, storyServer } from '../../../.storybook/harness';

/**
 * The workspace menu in the header: this machine's workspaces (searchable
 * past a handful), agent homes, other machines, and workspace management.
 */

const workspaces = [
  createWorkspace({ id: 'ws-app', name: 'app', path: '/home/user/app' }),
  createWorkspace({ id: 'ws-infra', name: 'infra', path: '/home/user/infra', additionalPaths: ['/home/user/infra-config'] }),
  createWorkspace({ id: 'ws-docs', name: 'docs', path: '/home/user/docs' }),
  createWorkspace({ id: 'ws-scratch', name: 'scratch', path: '/virtual/scratch', isVirtual: true }),
  createWorkspace({ id: 'ws-agent', name: 'reviewer', path: '/home/user/.prokopai/agents/reviewer', settings: { isAgentHome: true, agentId: 'agent-1' } }),
];
const agents = [createAgent({ id: 'agent-1', name: 'reviewer' })];
const many = Array.from({ length: 50 }, (_, i) => createWorkspace({ id: `ws-${i}`, name: `project-${String(i).padStart(2, '0')}`, path: `/home/user/project-${i}` }));

const otherHosts = [
  { server: { ...storyServer, id: 'laptop', name: 'Laptop' }, state: 'ready' as const, workspaces: [createWorkspace({ id: 'l-1', name: 'app (laptop)', path: '/Users/me/app' }), createWorkspace({ id: 'l-2', name: 'notes', path: '/Users/me/notes' })] },
  { server: { ...storyServer, id: 'office', name: 'Office desktop' }, state: 'offline' as const, workspaces: [createWorkspace({ id: 'o-1', name: 'legacy', path: '/srv/legacy' })] },
  { server: { ...storyServer, id: 'new-box', name: 'New box' }, state: 'unpaired' as const, workspaces: [] },
  { server: { ...storyServer, id: 'slow', name: 'Slow host' }, state: 'loading' as const, workspaces: [] },
];

const management = {
  onCreateVirtualWorkspace: fn(),
  onCreatePhysicalWorkspace: fn(),
  onDeleteWorkspace: fn(),
  onRenameWorkspace: fn(),
  onUpdateWorkspacePath: fn(),
  onUpdateWorkspacePaths: fn(),
};

const meta = {
  title: 'Sessions/WorkspaceSwitcher',
  component: WorkspaceSwitcher,
  parameters: { layout: 'centered' },
  args: { workspaces, agents, activeWorkspace: workspaces[0] ?? null, onSelectWorkspace: fn(), onOpenChange: fn(), onPreviewWorkspace: fn(), sdkClient: createFakeSdkClient(), ...management },
  decorators: [withUIStore()],
} satisfies Meta<typeof WorkspaceSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SelectionOnly: Story = {
  args: { selectionOnly: true, ...Object.fromEntries(Object.keys(management).map((key) => [key, undefined])) } as never,
};

export const WithOtherMachines: Story = {
  args: { currentHostName: 'This machine', otherHosts, onSelectHostWorkspace: fn(), waitingByHost: { laptop: 2 } },
};

export const ManyWorkspaces: Story = {
  args: { workspaces: many, activeWorkspace: many[3] ?? null },
};

export const NoWorkspaces: Story = {
  args: { workspaces: [], activeWorkspace: null },
};

export const Busy: Story = {
  args: { isCreatingWorkspace: true, deletingWorkspaceId: 'ws-docs', isUpdatingWorkspace: { 'ws-infra': true } },
};

export const Phone: Story = {
  args: { currentHostName: 'This machine', otherHosts, onSelectHostWorkspace: fn() },
  globals: { viewport: { value: 'phone' } },
};
