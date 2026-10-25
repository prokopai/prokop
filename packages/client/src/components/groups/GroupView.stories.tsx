import type { Meta, StoryObj } from '@storybook/react-vite';
import { GroupView } from './GroupView';
import { createFakeSdkClient, withAppContexts, type FakeHttp } from '../../../.storybook/harness';
import { createAgentGroup, createGroupThread, createSession, createWorkspace } from '../../../.storybook/mocks';
import { withConnectionStore, withSessionStore } from '../../../.storybook/mocks/storeDecorators';

/**
 * A group chat in the center: members with their status, the shared thread,
 * and the composer. Group and thread come from the fake server; member
 * sessions from the session store decide the status chips.
 */
const workspace = createWorkspace({ id: 'ws-1', name: 'app', path: '/home/user/app' });
const group = createAgentGroup({ id: 'group-1', workspaceId: workspace.id });

function client(http: FakeHttp = {}) {
  return createFakeSdkClient({ workspace, http: { groups: { get: async () => ({ group }), listMessages: async () => ({ messages: createGroupThread('group-1'), hasMore: false }) }, ...http } });
}

const memberSessions = [
  createSession({ id: 'sess-implementer', workspaceId: workspace.id, title: 'API work: Implementer', runningAt: new Date().toISOString() }),
  createSession({ id: 'sess-reviewer', workspaceId: workspace.id, title: 'API work: Reviewer' }),
  createSession({ id: 'sess-architect', workspaceId: workspace.id, title: 'API work: Idea Architect' }),
];

const meta = {
  title: 'Chat/GroupView',
  component: GroupView,
  parameters: { layout: 'fullscreen' },
  args: { client: client(), serverId: 'story-server', groupId: 'group-1', projectName: 'app' },
  decorators: [
    (Story) => <div className="flex h-screen flex-col overflow-hidden bg-background"><Story /></div>,
    withAppContexts(),
    withSessionStore({ sessions: memberSessions }),
    withConnectionStore({ connected: true, streamingSessionIds: new Set(['sess-implementer']) }),
  ],
} satisfies Meta<typeof GroupView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The implementer is working, the others idle. */
export const Thread: Story = {};

/** On a phone the members sit on their own row under the name; the ones that do not fit fold into a "+N" chip. */
export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};

const tenNames = ['Implementer', 'Reviewer', 'Idea Architect', 'Researcher', 'Tester', 'Writer', 'Designer', 'Ops', 'Security', 'Planner'];
const tenMembers = tenNames.map((name, index) => ({ agentId: name.toLowerCase().replace(/\s+/g, '-'), name, sessionId: `sess-ten-${index}`, cursorSeq: 0, joinedAt: '2026-10-24T00:00:00.000Z' }));
const tenGroup = createAgentGroup({ id: 'group-1', workspaceId: workspace.id, name: 'Everyone', members: tenMembers });

/** The largest group: the header shows the members that fit and folds the rest behind "+N". */
export const TenMembers: Story = {
  args: { client: client({ groups: { get: async () => ({ group: tenGroup }), listMessages: async () => ({ messages: createGroupThread('group-1'), hasMore: false }) } }) },
  decorators: [withSessionStore({ sessions: tenMembers.map((member, index) => createSession({ id: member.sessionId, workspaceId: workspace.id, title: `Everyone: ${member.name}`, ...(index === 7 ? { runningAt: new Date().toISOString() } : {}) })) })],
};

export const EmptyThread: Story = {
  args: { client: client({ groups: { get: async () => ({ group }), listMessages: async () => ({ messages: [], hasMore: false }) } }) },
};

export const Loading: Story = {
  args: { client: createFakeSdkClient({ workspace, latencyMs: 60_000 }) },
};

export const Gone: Story = {
  args: { client: client({ groups: { get: async () => { throw new Error('Group not found'); } } }) },
};
