import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import WorkspaceView from './WorkspaceView';
import { createDefaultViewLayout, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';
import { workspaceScene, SCENE_SESSION, SCENE_WORKSPACE, STORY_ROUTES } from '../../../.storybook/harness';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { createSidebarSessions } from '../../../.storybook/mocks/mockSidebar';

/**
 * The single-workspace screen: sidebar with sessions, the board, repository
 * docks and the terminal, all fed by the fake server. The closest thing to
 * the running app without a server.
 */

const { sessions } = createSidebarSessions(SCENE_WORKSPACE.id);
const second = createSession({ id: 'sess-two', workspaceId: SCENE_WORKSPACE.id, title: 'Deploy to staging', runningAt: new Date().toISOString() });

function withLayout(open: { left?: boolean; right?: boolean; bottom?: boolean } = {}) {
  return function LayoutDecorator(Story: ComponentType) {
    const initial = useDockStore.getInitialState().docks;
    useDockStore.setState({ docks: { left: { ...initial.left, open: open.left ?? true }, right: { ...initial.right, open: open.right ?? true }, bottom: { ...initial.bottom, open: open.bottom ?? false } } });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileSurface: 'chat', mobileTerminalOpen: false });
    return <Story />;
  };
}

const scene = (extra: Parameters<typeof workspaceScene>[0] = {}) => workspaceScene({
  workspace: SCENE_WORKSPACE,
  sessions: [SCENE_SESSION, second, ...sessions],
  open: [SCENE_SESSION.id],
  route: STORY_ROUTES.workspaceSession,
  contexts: { client: { workspace: SCENE_WORKSPACE } },
  ...extra,
});

const meta = {
  title: 'Screens/WorkspaceView',
  component: WorkspaceView,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: mounts the Pierre file tree and xterm; happy-dom has no layout for either',
  },
  decorators: [(Story) => <div className="flex h-screen flex-col bg-background"><Story /></div>],
} satisfies Meta<typeof WorkspaceView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withLayout(), ...scene()],
};

export const TwoSessionsOpen: Story = {
  decorators: [withLayout(), ...scene({ open: [SCENE_SESSION.id, second.id] })],
};

export const NoSessionOpen: Story = {
  decorators: [withLayout(), ...scene({ open: [], focused: null, route: STORY_ROUTES.workspace })],
};

export const EmptyWorkspace: Story = {
  decorators: [withLayout(), ...scene({ sessions: [], open: [], focused: null, messages: [], route: STORY_ROUTES.workspace })],
};

export const Disconnected: Story = {
  decorators: [withLayout(), ...scene({ connected: false })],
};

export const WithTerminal: Story = {
  decorators: [withLayout({ bottom: true }), ...scene()],
};

export const Laptop: Story = {
  decorators: [withLayout(), ...scene()],
  globals: { viewport: { value: 'laptop' } },
};

export const Phone: Story = {
  decorators: [withLayout(), ...scene()],
  globals: { viewport: { value: 'phone' } },
};
