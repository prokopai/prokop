import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageInput } from './MessageInput';
import {
  withServerDataStore,
  withUIStore,
} from '../../../.storybook/mocks/storeDecorators';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { createPreconfigList } from '../../../.storybook/mocks/mockPreconfig';

// The session gives the composer its row of chips: checkout, agent, model, permissions, format.
const workspace = createWorkspace({ name: 'my-project', path: '/home/user/my-project' });
const preconfigs = createPreconfigList();
const session = createSession({
  id: 'story-session-1',
  workspaceId: workspace.id,
  preconfigId: preconfigs[0]?.id ?? null,
  selectedModel: 'claude-3.5-sonnet',
  selectedProvider: 'anthropic',
});

const meta = {
  title: 'Chat/MessageInput',
  component: MessageInput,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    // The input lives at the bottom of the session pane, which paints bg-card on
    // the app field. Stage it the same way so fill and edge are judged against
    // the real backdrop, not the story canvas.
    (Story) => (
      <div className="app-field min-h-[20rem] p-6">
        <div className="glass-panel flex min-h-[17rem] flex-col justify-end overflow-hidden rounded-xl bg-card">
          <Story />
        </div>
      </div>
    ),
    withServerDataStore({ workspaces: [workspace], activeWorkspaceId: workspace.id, preconfigs }),
    withUIStore(),
  ],
  args: {
    onSendMessage: () => {},
    disabled: false,
    placeholder: 'Type a message...',
    workspaceId: workspace.id,
    sdkClient: null,
    prompts: [],
    sessionId: session.id,
    session,
    modelSupportsImage: true,
  },
} as Meta<typeof MessageInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const WithPlaceholder: Story = {
  args: {
    placeholder: 'Ask anything about your codebase...',
  },
};

export const StreamingState: Story = {
  args: {
    isStreaming: true,
    onStopStreaming: () => {},
  },
};

export const WithoutImageSupport: Story = {
  args: {
    modelSupportsImage: false,
  },
};

export const WithPrompts: Story = {
  args: {
    prompts: [
      { name: 'fix', content: 'Fix the following issue: ARG', description: 'Fix a code issue' },
      { name: 'refactor', content: 'Refactor the following code to improve readability and performance: ARG', description: 'Refactor code' },
      { name: 'test', content: 'Write comprehensive tests for the following code: ARG', description: 'Generate tests' },
      { name: 'document', content: 'Add documentation and inline comments to the following code: ARG', description: 'Document code' },
      { name: 'explain', content: 'Explain what this code does in detail: ARG', description: 'Explain code' },
    ],
  },
};

export const NoWorkspace: Story = {
  args: {
    workspaceId: undefined,
  },
};

export const WithoutSession: Story = {
  args: {
    sessionId: undefined,
  },
};
