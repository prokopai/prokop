import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionPane } from './SessionPane';
import { useAskStore } from '@/stores/askStore';
import { useSessionControlStore } from '@/stores/sessionControlStore';
import { useSessionContentStore } from '@/stores/sessionContentStore';
import { workspaceScene, SCENE_SESSION, createFakeSdkClient, STORY_SERVER_URL } from '../../../.storybook/harness';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { createAssistantMessage, createAssistantMessageWithRunningTool, createQueuedMessage, createTextPart, createUserMessageWithParts } from '../../../.storybook/mocks/mockMessage';
import { createPermissionAsk } from '../../../.storybook/mocks/mockPermission';
import { mockId } from '../../../.storybook/mocks/mockHelpers';

/**
 * One conversation pane on the board, fed from the stores: transcript,
 * composer, asks, queue. ChatView shows the same surface with props.
 */

const client = createFakeSdkClient();

const meta = {
  title: 'Workspace/SessionPane',
  component: SessionPane,
  parameters: { layout: 'fullscreen' },
  args: { sessionId: SCENE_SESSION.id, sdkClient: client, serverUrl: STORY_SERVER_URL },
  decorators: [(Story) => <div className="flex h-screen flex-col overflow-hidden bg-card"><Story /></div>, ...workspaceScene()],
} satisfies Meta<typeof SessionPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {};

export const Empty: Story = {
  decorators: workspaceScene({ messages: [] }),
};

export const Streaming: Story = {
  decorators: workspaceScene({
    streaming: true,
    sessions: [createSession({ ...SCENE_SESSION, runningAt: new Date().toISOString() })],
    messages: [
      createUserMessageWithParts('Run the build and check for errors', SCENE_SESSION.id),
      createAssistantMessageWithRunningTool('shell', SCENE_SESSION.id),
    ],
  }),
};

export const WaitingForApproval: Story = {
  decorators: [
    (Story: ComponentType) => {
      useAskStore.setState({ pendingRequests: [{ toolCallId: mockId('call'), sessionId: SCENE_SESSION.id, toolName: 'shell', ask: createPermissionAsk() } as never] });
      return <Story />;
    },
    ...workspaceScene({
      streaming: true,
      messages: [
        createUserMessageWithParts('Deploy to staging', SCENE_SESSION.id),
        { message: createAssistantMessage({ sessionId: SCENE_SESSION.id, status: 'streaming' }), parts: [createTextPart({}, 'I need to run the deployment command.')] },
      ],
    }),
  ],
};

export const WithQueue: Story = {
  decorators: [
    (Story: ComponentType) => {
      useSessionContentStore.getState().setQueuedMessagesForSession(SCENE_SESSION.id, [
        createQueuedMessage({ sessionId: SCENE_SESSION.id, content: 'Also update the README.' }),
        createQueuedMessage({ sessionId: SCENE_SESSION.id, content: 'Then run the tests again.' }),
      ]);
      return <Story />;
    },
    ...workspaceScene({ streaming: true, sessions: [createSession({ ...SCENE_SESSION, runningAt: new Date().toISOString() })] }),
  ],
};

export const Observing: Story = {
  decorators: [
    (Story: ComponentType) => {
      useSessionControlStore.setState({ controlBySessionId: { [SCENE_SESSION.id]: { sessionId: SCENE_SESSION.id, controllerClientId: 'another-device', status: 'controlled' } } });
      return <Story />;
    },
    ...workspaceScene(),
  ],
};

export const Archived: Story = {
  decorators: workspaceScene({ sessions: [createSession({ ...SCENE_SESSION, status: 'closed' })] }),
};

export const Disconnected: Story = {
  decorators: workspaceScene({ connected: false }),
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
