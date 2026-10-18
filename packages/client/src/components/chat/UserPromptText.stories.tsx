import type { Meta, StoryObj } from '@storybook/react-vite';
import { UserPromptText } from './UserPromptText';

/**
 * A sent prompt: file links become chips, terminal markers resolve from the
 * hidden context envelope at the end of the text.
 */

const envelope = [
  'Why does this test fail? See [zsh](#context-term-1).',
  '',
  '<prokop_context>',
  '<terminal id="term-1" label="zsh" cwd="/home/user/my-project">',
  '$ bun test',
  '✗ rejects an expired token',
  '</terminal>',
  '</prokop_context>',
].join('\n');

const meta: Meta<typeof UserPromptText> = {
  title: 'Chat/UserPromptText',
  component: UserPromptText,
  parameters: { layout: 'padded' },
  args: { sessionId: 'prompt-session' },
  decorators: [(Story) => <div className="max-w-2xl text-sm"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
  args: { text: 'Refactor the auth module and keep the public API.' },
};

export const Markdown: Story = {
  args: { text: 'Please:\n\n1. keep the **public API**\n2. add `exp` validation\n3. write tests\n\n```ts\nexpect(verify(token)).toBeNull();\n```' },
};

export const FileReferences: Story = {
  args: { text: 'Look at [src/auth/session.ts](src/auth/session.ts#L42-L58) and [src/components/](src/components/) then explain the flow.' },
};

export const TerminalReference: Story = {
  args: { text: envelope },
};

export const MissingTerminal: Story = {
  args: { text: 'Output was here: [zsh](#context-gone).' },
};

export const ExternalLink: Story = {
  args: { text: 'Docs: [TanStack Router](https://tanstack.com/router) and a plain https://example.com link.' },
};

export const FormattedBody: Story = {
  args: { text: 'shout this', formatBody: (body: string) => body.toUpperCase() },
};
