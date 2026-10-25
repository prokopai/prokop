import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { GroupThread } from './GroupThread';
import { createGroupThread, GROUP_MEMBERS } from '../../../.storybook/mocks';

/** The shared thread of a group: the person, members with tool lines, a handoff, a join, and a member's approval. */
const thread = createGroupThread();

const meta: Meta<typeof GroupThread> = {
  title: 'Chat/GroupThread',
  component: GroupThread,
  parameters: { layout: 'fullscreen' },
  args: { groupId: 'group-scene', members: GROUP_MEMBERS, messages: thread, onLoadOlder: fn(), onAskResponse: fn(), onOpenMemberSession: fn() },
  decorators: [(Story) => <div className="flex h-screen flex-col bg-background"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Thread: Story = {};

export const Empty: Story = { args: { messages: [] } };

export const WithOlderMessages: Story = { args: { hasOlder: true } };

export const LoadingOlder: Story = { args: { hasOlder: true, loadingOlder: true } };

/** The reviewer's reply streams in under the thread until the finished message lands. */
export const MemberWriting: Story = {
  args: {
    live: [{
      member: GROUP_MEMBERS[1]!,
      message: { id: 'a-live', sessionId: 'sess-reviewer', role: 'assistant', status: 'streaming', modelId: 'gpt-5.5', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: Date.now() },
      parts: [
        { id: 'live-tool', messageId: 'a-live', createdAt: Date.now(), type: 'tool', callId: 'c-live', name: 'read-file', state: { status: 'completed', input: { file_path: 'middleware.ts' }, output: 'ok', startedAt: Date.now() - 2000, completedAt: Date.now() } },
        { id: 'live-text', messageId: 'a-live', createdAt: Date.now(), type: 'text', text: 'The Redis bucket looks right. One thing I still want to check is the TTL on' },
      ],
    }],
  },
};

/** A member waits for an approval; it is answered here, in the group. */
export const MemberNeedsYou: Story = {
  args: {
    asks: [{
      member: GROUP_MEMBERS[1]!,
      request: {
        toolCallId: 'call-1', sessionId: 'sess-reviewer', toolName: 'shell', requestId: 'req-1',
        ask: { type: 'permission', question: 'Run `bun test` in the project?', risk: 'medium', scope: { kind: 'tool', tool: 'shell' } } as never,
      },
    }],
  },
};
