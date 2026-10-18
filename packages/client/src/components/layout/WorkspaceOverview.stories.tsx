import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { WorkspaceOverview } from './WorkspaceOverview';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { createAgent, createSidebarSessions, groupByTag } from '../../../.storybook/mocks/mockSidebar';

/**
 * The Overview: sessions of several workspaces at once, grouped by
 * workspace and tag, with the group selector on top.
 */

const workspaces = [
  createWorkspace({ id: 'ws-app', name: 'app', path: '/home/user/app' }),
  createWorkspace({ id: 'ws-infra', name: 'infra', path: '/home/user/infra' }),
  createWorkspace({ id: 'ws-docs', name: 'docs', path: '/home/user/docs' }),
];
const agents = [createAgent({ id: 'agent-1', name: 'reviewer' })];
const groups: OverviewGroup[] = [
  { id: 'g-all', serverId: 'story-server', name: 'Everything', workspaceIds: workspaces.map((w) => w.id) },
  { id: 'g-work', serverId: 'story-server', name: 'Work', workspaceIds: ['ws-app', 'ws-infra'] },
];

const perWorkspace = Object.fromEntries(workspaces.map((w) => [w.id, createSidebarSessions(w.id)]));
const sessionsByWorkspace = Object.fromEntries(workspaces.map((w) => [w.id, perWorkspace[w.id]!.sessions.filter((s) => !s.parentId && s.status !== 'closed')]));
const tags = Object.fromEntries(workspaces.map((w) => [w.id, groupByTag(sessionsByWorkspace[w.id]!)]));
const childrenMap = new Map(workspaces.flatMap((w) => [...perWorkspace[w.id]!.childrenMap.entries()]));
const sessionDerivedValues = new Map(workspaces.flatMap((w) => [...perWorkspace[w.id]!.derived.entries()]));

const { document: _document, hydrationStatus: _status, ...groupActions } = useOverviewGroupsStore.getState();

const callbacks = {
  onResumeSession: fn(),
  onOpenAlongside: fn(),
  onCloseSession: fn(),
  onReopenSession: fn(),
  onDeleteSession: fn(),
  onRenameSession: fn(),
  onRegenerateSessionTitle: fn(),
  onCreateSessionInWorkspace: fn(),
  onOpenPullRequests: fn(),
  onAddTag: fn(),
  onRemoveTag: fn(),
  onLoadMoreWorkspace: fn(),
};

const meta: Meta<typeof WorkspaceOverview> = {
  title: 'Sessions/WorkspaceOverview',
  component: WorkspaceOverview,
  parameters: { layout: 'fullscreen' },
  args: {
    sessionsByWorkspace,
    tagGroupsByWorkspace: Object.fromEntries(workspaces.map((w) => [w.id, tags[w.id]!.tagGroups])),
    orderedTagNamesByWorkspace: Object.fromEntries(workspaces.map((w) => [w.id, tags[w.id]!.orderedTagNames])),
    allWorkspaceTagsByWorkspace: Object.fromEntries(workspaces.map((w) => [w.id, tags[w.id]!.allTags])),
    childrenMap,
    sessionDerivedValues,
    currentSession: null,
    currentSessionId: null,
    workspaceIds: workspaces.map((w) => w.id),
    workspaces,
    agents,
    activeWorkspace: workspaces[0] ?? null,
    isHydrated: true,
    groups,
    activeGroup: groups[0] ?? null,
    groupActions,
    serverId: 'story-server',
    connected: true,
    ...callbacks,
  },
  decorators: [(Story) => <div className="flex h-screen w-96 flex-col border-r bg-sidebar text-sidebar-foreground"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithCurrentSession: Story = {
  args: { currentSessionId: sessionsByWorkspace['ws-app']![0]!.id, currentSession: sessionsByWorkspace['ws-app']![0] ?? null },
};

export const TwoWorkspaces: Story = {
  args: { workspaceIds: ['ws-app', 'ws-infra'], activeGroup: groups[1] ?? null },
};

export const EmptyWorkspaces: Story = {
  args: { sessionsByWorkspace: Object.fromEntries(workspaces.map((w) => [w.id, []])), tagGroupsByWorkspace: {}, orderedTagNamesByWorkspace: {}, childrenMap: new Map(), sessionDerivedValues: new Map() },
};

export const MoreToLoad: Story = {
  args: { hasMoreByWorkspace: { 'ws-app': true, 'ws-infra': true }, loadingMoreWorkspace: 'ws-infra' },
};

export const Disconnected: Story = {
  args: { connected: false },
};

export const Hydrating: Story = {
  args: { isHydrated: false },
};
