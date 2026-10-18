import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceContentArea } from './WorkspaceContentArea';
import { createDefaultViewLayout, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { createFakeSdkClient, workspaceScene, SCENE_SESSION, SCENE_WORKSPACE, STORY_SERVER_URL } from '../../../.storybook/harness';
import { createSession } from '../../../.storybook/mocks/mockSession';

/**
 * Everything inside the workspace frame: session tabs from the board, file
 * tabs from the editor store, repository views, usage and the terminal, all
 * placed by the view store. The real panels render here, so the fake server
 * answers files, Git and worktrees too.
 */

const second = createSession({ id: 'sess-two', workspaceId: SCENE_WORKSPACE.id, title: 'Deploy to staging', runningAt: new Date().toISOString() });
const client = createFakeSdkClient({ workspace: SCENE_WORKSPACE });

function withLayout(mutate?: () => void) {
  return function LayoutDecorator(Story: ComponentType) {
    const initial = useDockStore.getInitialState().docks;
    useDockStore.setState({ docks: { left: { ...initial.left, open: true }, right: { ...initial.right, open: true }, bottom: { ...initial.bottom, open: false } } });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileSurface: 'chat', mobileTerminalOpen: false });
    const store = useFileEditorStore.getState();
    for (const id of store.openDocIds) store.closeDoc(id);
    mutate?.();
    return <Story />;
  };
}

const meta = {
  title: 'Screens/WorkspaceContentArea',
  component: WorkspaceContentArea,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: mounts the Pierre file tree and xterm; happy-dom has no layout for either',
  },
  args: {
    sdkClient: client,
    serverUrl: STORY_SERVER_URL,
    sessionsHeader: <div className="px-3 py-2 text-sm font-medium">my-project</div>,
    sessionsContent: <div className="px-3 py-2 text-xs text-muted-foreground">Session list (see Sessions/WorkspaceSessionContent)</div>,
    bottom: <div className="flex h-full items-center justify-center text-xs text-muted-foreground">terminal dock</div>,
  },
  decorators: [(Story) => <div className="flex h-screen flex-col bg-background p-2"><Story /></div>],
} satisfies Meta<typeof WorkspaceContentArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneSession: Story = {
  decorators: [withLayout(), ...workspaceScene({ workspace: SCENE_WORKSPACE, contexts: { client: { workspace: SCENE_WORKSPACE } } })],
};

export const TwoSessionsSideBySide: Story = {
  decorators: [
    withLayout(() => useWorkspaceViewStore.getState().splitView(`session:story-server:${second.id}`, 'right', [`session:story-server:${SCENE_SESSION.id}`, `session:story-server:${second.id}`])),
    ...workspaceScene({ workspace: SCENE_WORKSPACE, sessions: [SCENE_SESSION, second], open: [SCENE_SESSION.id, second.id], contexts: { client: { workspace: SCENE_WORKSPACE } } }),
  ],
};

export const WithOpenFile: Story = {
  decorators: [
    withLayout(() => {
      useFileEditorStore.getState().openDoc({ serverId: 'story-server', workspaceId: SCENE_WORKSPACE.id, root: '', path: 'src/auth/session.ts' }, 'session.ts');
    }),
    ...workspaceScene({ workspace: SCENE_WORKSPACE, contexts: { client: { workspace: SCENE_WORKSPACE } } }),
  ],
};

export const NoSessionOpen: Story = {
  decorators: [withLayout(), ...workspaceScene({ workspace: SCENE_WORKSPACE, sessions: [], contexts: { client: { workspace: SCENE_WORKSPACE } } })],
};

export const Phone: Story = {
  decorators: [withLayout(), ...workspaceScene({ workspace: SCENE_WORKSPACE, contexts: { client: { workspace: SCENE_WORKSPACE } } })],
  globals: { viewport: { value: 'phone' } },
};
