import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { WorkspaceSessionContent } from './WorkspaceSessionContent';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { withServerDataStore } from '../../../.storybook/mocks/storeDecorators';
import { withSdkClient } from '../../../.storybook/harness';
import { createSidebarSessions, groupByTag, scheduledJobPresets } from '../../../.storybook/mocks/mockSidebar';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { mockIsoHoursAgo } from '../../../.storybook/mocks/mockHelpers';

/**
 * The workspace sidebar body: active sessions grouped by tag or checkout,
 * archived sessions, scheduled jobs, bulk selection.
 */

const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project' });
const { sessions, childrenMap, derived } = createSidebarSessions(workspace.id);
const active = sessions.filter((s) => !s.parentId && s.status !== 'closed');
const archived = [
  ...sessions.filter((s) => s.status === 'closed'),
  createSession({ workspaceId: workspace.id, title: 'Archived spike on virtualization', status: 'closed', updatedAt: mockIsoHoursAgo(200) }),
];
const { tagGroups, orderedTagNames, allTags } = groupByTag(active);
const jobs = Object.values(scheduledJobPresets);

const callbacks = {
  onSessionTagOrderChange: fn(),
  onLoadMore: fn(),
  onResumeSession: fn(),
  onOpenAlongside: fn(),
  onCloseSession: fn(),
  onReopenSession: fn(),
  onDeleteSession: fn(),
  onRenameSession: fn(),
  onRegenerateSessionTitle: fn(),
  onBulkCloseSessions: fn(),
  onBulkDeleteSessions: fn(),
  onAddTag: fn(),
  onRemoveTag: fn(),
  onCreateScheduledJob: fn(),
  onEditScheduledJob: fn(),
  onPauseScheduledJob: fn(),
  onResumeScheduledJob: fn(),
  onTriggerScheduledJob: fn(),
  onDeleteScheduledJob: fn(),
};

const meta = {
  title: 'Sessions/WorkspaceSessionContent',
  component: WorkspaceSessionContent,
  parameters: { layout: 'fullscreen' },
  args: {
    workspaceId: workspace.id,
    activeSessions: active,
    archivedSessions: archived,
    scheduledJobs: jobs,
    scheduledJobsLoaded: true,
    scheduledSessionsByJob: new Map(),
    childrenMap,
    sessionDerivedValues: derived,
    currentSessionId: active[0]!.id,
    tagGroups,
    orderedTagNames,
    allWorkspaceTags: allTags,
    sessionTagOrder: 'tagged-first',
    ...callbacks,
  },
  decorators: [
    (Story) => <div className="flex h-screen w-80 flex-col border-r bg-sidebar text-sidebar-foreground"><Story /></div>,
    withSdkClient({ workspace }),
    withServerDataStore({ workspaces: [workspace], activeWorkspaceId: workspace.id }),
  ],
} satisfies Meta<typeof WorkspaceSessionContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** An agent's home: conversations other agents started here sit in their own folded section. */
export const WithAgentConversations: Story = {
  args: {
    isAgentHome: true,
    agentConversationSessions: [
      createSession({ workspaceId: workspace.id, title: 'From Coding: Refactor auth', updatedAt: mockIsoHoursAgo(1),
        metadata: { agentConversation: { senderSessionId: 'coding-session', senderAgentId: 'coding' } } }),
      createSession({ workspaceId: workspace.id, title: 'From Researcher: Pricing page', updatedAt: mockIsoHoursAgo(5),
        metadata: { agentConversation: { senderSessionId: 'research-session', senderAgentId: 'researcher' } } }),
    ],
  },
};

export const UntaggedFirst: Story = {
  args: { sessionTagOrder: 'untagged-first' },
};

export const NoTags: Story = {
  args: { tagGroups: new Map(), orderedTagNames: [], allWorkspaceTags: [] },
};

export const NoSessions: Story = {
  args: { activeSessions: [], archivedSessions: [], scheduledJobs: [], tagGroups: new Map(), orderedTagNames: [], childrenMap: new Map(), sessionDerivedValues: new Map(), currentSessionId: null },
};

export const ManySessions: Story = {
  args: {
    activeSessions: Array.from({ length: 60 }, (_, i) => createSession({ workspaceId: workspace.id, title: `Session ${i + 1}: ${['refactor', 'investigate', 'write tests for', 'document'][i % 4]} module ${i}`, tags: i % 5 === 0 ? ['auth'] : [], updatedAt: mockIsoHoursAgo(i) })),
    tagGroups: new Map(),
    orderedTagNames: [],
    hasNextPage: true,
  },
};

export const LoadingMore: Story = {
  args: { hasNextPage: true, isFetchingNextPage: true },
};

export const SavingSettings: Story = {
  args: { isSavingSettings: true },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
