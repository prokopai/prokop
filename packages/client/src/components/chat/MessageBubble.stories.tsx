import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { MessageBubble } from './MessageBubble';
import {
  createUserMessage,
  createAssistantMessage,
} from '../../../.storybook/mocks/mockMessage';
import {
  simpleMarkdown,
  richMarkdown,
  inlineFormattingMarkdown,
  codeBlocksMarkdown,
  shortMarkdown,
  generateLongMarkdown,
  logOutputMarkdown,
  userCodeSnippetMarkdown,
} from '../../../.storybook/mocks/mockMarkdown';

const userMessage = createUserMessage({ role: 'user' });
const assistantMessage = createAssistantMessage({ role: 'assistant' });

const meta = {
  title: 'Chat/MessageBubble',
  component: MessageBubble,
  parameters: {
    layout: 'padded',
  },
  args: {
    message: userMessage,
    textContent: 'Hello, can you help me with TypeScript?',
    onRemove: () => {},
    onRevert: () => {},
    onFork: () => {},
  },
} satisfies Meta<typeof MessageBubble>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMessage: Story = {
  args: {
    message: userMessage,
    textContent: 'Hello, can you help me with TypeScript?',
    children: <p className="text-sm">Hello, can you help me with TypeScript?</p>,
  },
};

export const AssistantMessage: Story = {
  args: {
    message: assistantMessage,
    textContent: 'Sure! I would be happy to help. What do you need?',
    children: (
      <MarkdownRenderer>
        Sure! I would be happy to help. What do you need?
      </MarkdownRenderer>
    ),
  },
};

export const AssistantWithCode: Story = {
  args: {
    message: assistantMessage,
    textContent: 'Here is an example interface:',
    children: (
      <MarkdownRenderer>
        {`Here is an example interface:

\`\`\`typescript
interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}
\`\`\`

You can use this as a starting point for your type definitions.`}
      </MarkdownRenderer>
    ),
  },
};

export const LongUserMessage: Story = {
  args: {
    message: userMessage,
    textContent: 'Long message...',
    children: (
      <p className="text-sm">
        I am working on a complex project that involves multiple microservices communicating through a message queue.
        The system needs to handle high throughput with low latency, and I am considering using a combination of
        TypeScript for the service layer and Go for performance-critical components. The main challenge is ensuring
        type safety across service boundaries while maintaining flexibility for future changes.
      </p>
    ),
  },
};

export const QueuedMessage: Story = {
  args: {
    message: userMessage,
    isQueued: true,
    children: <p className="text-sm">This message is waiting to be sent...</p>,
  },
};

export const QueuedWithRemove: Story = {
  args: {
    message: userMessage,
    isQueued: true,
    onRemove: () => {},
    children: <p className="text-sm">Click the X to remove from queue</p>,
  },
};

export const WithRevertButton: Story = {
  args: {
    message: userMessage,
    canRevert: true,
    onRevert: () => {},
    children: <p className="text-sm">You can revert the conversation to this point</p>,
  },
};

export const WithForkButton: Story = {
  args: {
    message: userMessage,
    canFork: true,
    onFork: () => {},
    children: <p className="text-sm">You can fork the conversation from this point</p>,
  },
};

export const WithBothActions: Story = {
  args: {
    message: userMessage,
    canRevert: true,
    canFork: true,
    onRevert: () => {},
    onFork: () => {},
    children: <p className="text-sm">Both revert and fork are available</p>,
  },
};

export const ClearAll: Story = {
  args: {
    message: userMessage,
    canRevert: true,
    isClearAll: true,
    onRevert: () => {},
    children: <p className="text-sm">Reverting here will clear the entire conversation</p>,
  },
};

// =============================================================================
// Markdown Content Stories — Assistant messages with various markdown types
// =============================================================================

export const AssistantSimpleMarkdown: Story = {
  name: 'Assistant — Simple Markdown',
  args: {
    message: assistantMessage,
    textContent: simpleMarkdown,
    children: <MarkdownRenderer>{simpleMarkdown}</MarkdownRenderer>,
  },
};

export const AssistantRichMarkdown: Story = {
  name: 'Assistant — Rich Markdown',
  args: {
    message: assistantMessage,
    textContent: richMarkdown,
    children: <MarkdownRenderer>{richMarkdown}</MarkdownRenderer>,
  },
};

export const AssistantInlineFormatting: Story = {
  name: 'Assistant — Inline Formatting',
  args: {
    message: assistantMessage,
    textContent: inlineFormattingMarkdown,
    children: <MarkdownRenderer>{inlineFormattingMarkdown}</MarkdownRenderer>,
  },
};

export const AssistantCodeBlocks: Story = {
  name: 'Assistant — Code Blocks',
  args: {
    message: assistantMessage,
    textContent: codeBlocksMarkdown,
    children: <MarkdownRenderer>{codeBlocksMarkdown}</MarkdownRenderer>,
  },
};

export const AssistantLongContent: Story = {
  name: 'Assistant — Long Content',
  args: {
    message: assistantMessage,
    textContent: generateLongMarkdown(10),
    children: <MarkdownRenderer>{generateLongMarkdown(10)}</MarkdownRenderer>,
  },
};

// =============================================================================
// Queued Messages with Markdown Content
// =============================================================================

export const QueuedWithMarkdown: Story = {
  name: 'Queued — With Markdown Content',
  args: {
    message: userMessage,
    isQueued: true,
    onRemove: () => {},
    children: <MarkdownRenderer>{shortMarkdown}</MarkdownRenderer>,
  },
};

export const QueuedWithRichMarkdown: Story = {
  name: 'Queued — With Rich Markdown',
  args: {
    message: userMessage,
    isQueued: true,
    onRemove: () => {},
    children: <MarkdownRenderer>{simpleMarkdown}</MarkdownRenderer>,
  },
};

// =============================================================================
// Conversation Thread — full markdown rendering across turns
// =============================================================================

export const ConversationThread: Story = {
  render: () => (
    <div className="max-w-2xl space-y-4">
      <MessageBubble message={createUserMessage()} textContent="Hey there!">
        <p className="text-sm">Hey there!</p>
      </MessageBubble>
      <MessageBubble message={createAssistantMessage()} textContent="Hi! How can I help?">
        <MarkdownRenderer>Hi! How can I help?</MarkdownRenderer>
      </MessageBubble>
      <MessageBubble message={createUserMessage()} textContent="Explain closures">
        <p className="text-sm">Can you explain closures in JavaScript?</p>
      </MessageBubble>
      <MessageBubble
        message={createAssistantMessage()}
        textContent="A closure is..."
      >
        <MarkdownRenderer>
          {`A **closure** is a function that has access to variables from its outer (enclosing) function scope, even after the outer function has returned.

\`\`\`javascript
function createCounter() {
  let count = 0;
  return () => ++count;
}
const counter = createCounter();
counter(); // 1
counter(); // 2
\`\`\`

The inner function "closes over" the \`count\` variable.`}
        </MarkdownRenderer>
      </MessageBubble>
    </div>
  ),
};

export const ConversationWithRichMarkdown: Story = {
  name: 'Conversation — Rich Markdown Thread',
  render: () => (
    <div className="max-w-2xl space-y-4">
      <MessageBubble message={createUserMessage()} textContent="Show me the API reference">
        <p className="text-sm">Can you show me the API reference with all the details?</p>
      </MessageBubble>
      <MessageBubble
        message={createAssistantMessage()}
        textContent={richMarkdown}
      >
        <MarkdownRenderer>{richMarkdown}</MarkdownRenderer>
      </MessageBubble>
      <MessageBubble message={createUserMessage()} textContent="What about code examples?">
        <p className="text-sm">Give me code examples in multiple languages.</p>
      </MessageBubble>
      <MessageBubble
        message={createAssistantMessage()}
        textContent={codeBlocksMarkdown}
      >
        <MarkdownRenderer>{codeBlocksMarkdown}</MarkdownRenderer>
      </MessageBubble>
      <MessageBubble
        message={createUserMessage()}
        isQueued
        onRemove={() => {}}
        textContent="Thanks, now show me inline formatting"
      >
        <MarkdownRenderer>{inlineFormattingMarkdown}</MarkdownRenderer>
      </MessageBubble>
    </div>
  ),
};

export const ConversationWithQueuedMessages: Story = {
  name: 'Conversation — With Queued Messages',
  render: () => (
    <div className="max-w-2xl space-y-4">
      <MessageBubble message={createUserMessage()} textContent="Hello!">
        <p className="text-sm">Hello!</p>
      </MessageBubble>
      <MessageBubble message={createAssistantMessage()} textContent="Hi there!">
        <MarkdownRenderer>Hi there! How can I help you today?</MarkdownRenderer>
      </MessageBubble>
      <MessageBubble
        message={createUserMessage()}
        isQueued
        onRemove={() => {}}
        textContent="This is a queued message with some **markdown**"
      >
        <MarkdownRenderer>{shortMarkdown}</MarkdownRenderer>
      </MessageBubble>
      <MessageBubble
        message={createUserMessage()}
        isQueued
        onRemove={() => {}}
        textContent="Another queued message with longer content"
      >
        <MarkdownRenderer>{simpleMarkdown}</MarkdownRenderer>
      </MessageBubble>
    </div>
  ),
};

// =============================================================================
// User Messages with Markdown — realistic pasted content
// =============================================================================

export const UserWithLogOutput: Story = {
  name: 'User — Pasted Log/Error Output',
  args: {
    message: userMessage,
    textContent: "The deploy failed, here is the log:\n\n```text\n2025-03-15T09:42:11.890Z ERROR 18234 --- [app-server] [         worker-1] db.migrate : Migration \"add-user-table\" failed\nDatabaseException: ERROR: relation \"users\" already exists\n  Position: 214 [Failed SQL: (0)\n--changeset app:add-user-table splitStatements:false\n\ncreate table users (\n    id bigint primary key,\n    email varchar(255) unique,\n    created_at timestamp default now()\n);\n```",
    children: <MarkdownRenderer>{logOutputMarkdown}</MarkdownRenderer>,
  },
};

export const UserWithCodeError: Story = {
  name: 'User — Code Error + Question',
  args: {
    message: userMessage,
    textContent: userCodeSnippetMarkdown,
    children: <MarkdownRenderer>{userCodeSnippetMarkdown}</MarkdownRenderer>,
  },
};

export const UserWithRichMarkdown: Story = {
  name: 'User — Rich Markdown',
  args: {
    message: userMessage,
    textContent: richMarkdown,
    children: <MarkdownRenderer>{richMarkdown}</MarkdownRenderer>,
  },
};

export const UserWithCodeBlocks: Story = {
  name: 'User — Code Blocks',
  args: {
    message: userMessage,
    textContent: codeBlocksMarkdown,
    children: <MarkdownRenderer>{codeBlocksMarkdown}</MarkdownRenderer>,
  },
};

export const UserWithLongMarkdown: Story = {
  name: 'User — Long Markdown',
  args: {
    message: userMessage,
    textContent: generateLongMarkdown(10),
    children: <MarkdownRenderer>{generateLongMarkdown(10)}</MarkdownRenderer>,
  },
};
