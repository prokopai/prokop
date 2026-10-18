import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceSessionView } from './WorkspaceSessionView';
import { workspaceScene, SCENE_SESSION, createFakeSdkClient, STORY_SERVER_URL } from '../../../.storybook/harness';

/** A session pane as a workspace tab: renders once visited, then stays mounted while hidden. */

const meta = {
  title: 'Workspace/WorkspaceSessionView',
  component: WorkspaceSessionView,
  parameters: { layout: 'fullscreen' },
  args: { sessionId: SCENE_SESSION.id, sdkClient: createFakeSdkClient(), serverUrl: STORY_SERVER_URL },
  decorators: [(Story) => <div className="flex h-screen flex-col overflow-hidden bg-card"><Story /></div>, ...workspaceScene()],
} satisfies Meta<typeof WorkspaceSessionView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Visible: Story = {};
