import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ArchiveIcon, GitForkIcon } from 'lucide-react';
import { formatHostEvent, joinContextEnvelope } from '@prokopai/sdk';
import { MessageRow, TranscriptDivider } from './TranscriptRow';
import {
  createAssistantMessage,
  createAssistantMessageWithCompletedTool,
  createAssistantMessageWithErrorTool,
  createAssistantMessageWithParts,
  createCompactionPart,
  createQueuedMessage,
  createReasonedAssistantMessageWithParts,
  createTextPart,
  createUserMessageWithParts,
} from '../../../.storybook/mocks/mockMessage';
import { withSessionStore } from '../../../.storybook/mocks/storeDecorators';

/** One transcript row per message kind, outside the virtualized list. */

const SESSION = 'row-session';

const rowArgs = {
  sessionId: SESSION,
  revertMessageId: null,
  isMainActiveSession: true,
  onRevert: fn(),
  onFork: fn(),
  onEditMessage: fn(),
  onRemoveFromQueue: fn(),
  onSteerQueued: fn(),
  onNavigateToSubagent: fn(),
  onTogglePinMessage: fn(),
  canPin: true,
};

const meta: Meta<typeof MessageRow> = {
  title: 'Chat/TranscriptRow',
  component: MessageRow,
  parameters: { layout: 'padded' },
  args: { ...rowArgs, item: createUserMessageWithParts('Refactor the auth module and keep the public API.', SESSION) },
  decorators: [withSessionStore(), (Story) => <div className="mx-auto max-w-3xl"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const UserPrompt: Story = {};

export const UserPromptWithReferences: Story = {
  args: { item: createUserMessageWithParts('Look at [src/auth/session.ts](src/auth/session.ts#L42-L58) and tell me what is wrong.', SESSION) },
};

export const AssistantText: Story = {
  args: { item: createAssistantMessageWithParts('The session helper accepts tokens without an `exp` claim. I will add a check and a test.', SESSION) },
};

export const AssistantWithReasoning: Story = {
  args: { item: createReasonedAssistantMessageWithParts('Need to check how exp is validated first.', 'Tokens without `exp` are accepted. Fixing it now.', SESSION) },
};

export const AssistantWithTool: Story = {
  args: { item: createAssistantMessageWithCompletedTool('read-file', SESSION) },
};

export const AssistantWithFailedTool: Story = {
  args: { item: createAssistantMessageWithErrorTool('shell', SESSION) },
};

export const Streaming: Story = {
  args: {
    item: {
      message: createAssistantMessage({ sessionId: SESSION, status: 'streaming' }),
      parts: [createTextPart({}, 'Writing the test for the missing `exp` claim. It should')],
    },
  },
};

export const Failed: Story = {
  args: {
    item: {
      message: createAssistantMessage({ sessionId: SESSION, status: 'error', error: '429 rate limit exceeded' }),
      parts: [],
    },
  },
};

export const Queued: Story = {
  args: {
    item: {
      message: { ...createUserMessageWithParts('Also update the README.', SESSION).message, id: 'queued-1' },
      parts: createUserMessageWithParts('Also update the README.', SESSION).parts,
      isQueued: true,
      queueId: createQueuedMessage({ sessionId: SESSION, content: 'Also update the README.' }).id,
    },
  },
};

/** A note the host delivered: a background command finished. Not a prompt bubble. */
export const HostEventShell: Story = {
  args: {
    item: createUserMessageWithParts(formatHostEvent(
      { kind: 'shell', id: 'c3', label: 'bun test', outcome: 'ok', meta: 'exit 0 · 2.1 s',
        summary: 'Background command c3 finished successfully after 2.1 s: `bun test`' },
      joinContextEnvelope('[bun test](#context-c3)\nFull output: /tmp/prokop/shell/c3.out', [
        { kind: 'terminal', id: 'c3', label: 'bun test', text: '✓ 42 tests passed' },
      ]),
    ), SESSION),
  },
};

export const HostEventTaskQueued: Story = {
  args: {
    item: {
      ...createUserMessageWithParts(formatHostEvent(
        { kind: 'task', id: 'child-1', label: 'Review the auth change', outcome: 'ok', meta: 'codex-cli · gpt-5.5',
          summary: '[task child-1 "Review the auth change" on codex-cli/gpt-5.5 finished]' },
        'task_id: child-1\n<task_result>\nThe change is sound.\n</task_result>',
      ), SESSION),
      isQueued: true,
      queueId: 'queued-event-1',
    },
  },
};

export const Compaction: Story = {
  args: {
    item: { message: createAssistantMessage({ sessionId: SESSION }), parts: [createCompactionPart()] },
  },
};

export const Pinned: Story = {
  args: { item: createAssistantMessageWithParts('Pinned summary of the plan.', SESSION), isPinned: true },
};

export const RevertTarget: Story = {
  render: (args) => {
    const item = createUserMessageWithParts('Revert to here.', SESSION);
    return <MessageRow {...args} item={item} revertMessageId={item.message.id} />;
  },
};

export const Dividers: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <TranscriptDivider>Context compacted</TranscriptDivider>
      <TranscriptDivider icon={<GitForkIcon className="size-3" />}>Forked from “Refactoring the auth module”</TranscriptDivider>
      <TranscriptDivider icon={<ArchiveIcon className="size-3" />}>Session archived</TranscriptDivider>
    </div>
  ),
};
