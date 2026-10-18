import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import OverviewView from './OverviewView';
import { createDefaultViewLayout, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useAttentionStore } from '@/lib/attention';
import { workspaceScene, SCENE_SESSION, SCENE_WORKSPACE, STORY_ROUTES, storyServer } from '../../../.storybook/harness';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { createAttentionSnapshot, createSidebarSessions } from '../../../.storybook/mocks/mockSidebar';

/**
 * The Overview screen: sessions of several workspaces, groups, other
 * machines, and the board. Fed by the fake server.
 */

const infra = createWorkspace({ id: 'ws-infra', name: 'infra', path: '/home/user/infra' });
const docs = createWorkspace({ id: 'ws-docs', name: 'docs', path: '/home/user/docs' });
const laptop = { ...storyServer, id: 'laptop', name: 'Laptop' };
const allSessions = [SCENE_SESSION, ...createSidebarSessions(SCENE_WORKSPACE.id).sessions, ...createSidebarSessions(infra.id).sessions.slice(0, 3), ...createSidebarSessions(docs.id).sessions.slice(0, 2)];

function withOverview(options: { attention?: boolean } = {}) {
  return function OverviewDecorator(Story: ComponentType) {
    const initial = useDockStore.getInitialState().docks;
    useDockStore.setState({ docks: { left: { ...initial.left, open: true }, right: { ...initial.right, open: false }, bottom: { ...initial.bottom, open: false } } });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileSurface: 'chat', mobileTerminalOpen: false });
    useServerDataStore.setState((state) => ({ workspaces: [...state.workspaces, infra, docs] }));
    useAttentionStore.setState({ hosts: options.attention ? { laptop: { connection: 'live', snapshot: createAttentionSnapshot() } } : {} });
    return <Story />;
  };
}

const scene = (extra: Parameters<typeof workspaceScene>[0] = {}) => workspaceScene({
  workspace: SCENE_WORKSPACE,
  sessions: allSessions,
  open: [SCENE_SESSION.id],
  route: STORY_ROUTES.overviewSession,
  contexts: { client: { workspace: SCENE_WORKSPACE }, server: { servers: [storyServer, laptop] } },
  ...extra,
});

const meta = {
  title: 'Screens/OverviewView',
  component: OverviewView,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: mounts the Pierre file tree and xterm; happy-dom has no layout for either',
  },
  decorators: [(Story) => <div className="flex h-screen flex-col bg-background"><Story /></div>],
} satisfies Meta<typeof OverviewView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withOverview(), ...scene()],
};

export const WithOtherMachines: Story = {
  decorators: [withOverview({ attention: true }), ...scene()],
};

export const NoSessionOpen: Story = {
  decorators: [withOverview(), ...scene({ open: [], focused: null, route: STORY_ROUTES.overview })],
};

export const Phone: Story = {
  decorators: [withOverview(), ...scene()],
  globals: { viewport: { value: 'phone' } },
};
