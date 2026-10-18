import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { UserPromptMap } from './UserPromptMap';
import {
  createAssistantMessage,
  createAssistantMessageWithParts,
  createCompactionPart,
  createConversation,
  createUserMessageWithParts,
} from '../../../.storybook/mocks/mockMessage';

/**
 * The prompt rail on the right of a wide transcript: one marker per user
 * prompt, with failed turns and compaction boundaries. Needs at least 928 px.
 */

const SESSION = 'map-session';

const conversation = createConversation([
  { user: 'Can you help me refactor the authentication module?', assistant: 'Of course.' },
  { user: 'Make sure to keep backward compatibility.', assistant: 'Understood.' },
  { user: 'Also add proper TypeScript types.', assistant: 'Done.' },
  { user: 'What about error handling?', assistant: 'Added.' },
  { user: 'Can you add unit tests too, covering the refresh path and the expired token case that we discussed earlier today?', assistant: 'Yes.' },
], SESSION);

const withFailureAndCompaction = [
  ...conversation.slice(0, 4),
  { message: createAssistantMessage({ sessionId: SESSION, status: 'error', error: 'rate limited' }), parts: [] },
  { message: createAssistantMessage({ sessionId: SESSION }), parts: [createCompactionPart()] },
  createUserMessageWithParts('Continue from where we left off.', SESSION),
  createAssistantMessageWithParts('Continuing.', SESSION),
];

const meta: Meta<typeof UserPromptMap> = {
  title: 'Chat/UserPromptMap',
  component: UserPromptMap,
  parameters: { layout: 'fullscreen' },
  args: { displayItems: conversation, onNavigate: fn() },
  decorators: [(Story) => (
    <div className="relative h-screen bg-background">
      <div className="mx-auto h-full max-w-3xl border-x border-dashed border-border/50" />
      <Story />
    </div>
  )],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTarget: Story = {
  args: { targetMessageId: conversation[4]?.message.id ?? null },
};

export const FailedTurnAndCompaction: Story = {
  args: { displayItems: withFailureAndCompaction },
};

export const ManyPrompts: Story = {
  args: {
    displayItems: createConversation(Array.from({ length: 40 }, (_, i) => ({ user: `Prompt number ${i + 1} about something`, assistant: 'ok' })), SESSION),
  },
};

export const SinglePrompt: Story = {
  args: { displayItems: conversation.slice(0, 2) },
};
