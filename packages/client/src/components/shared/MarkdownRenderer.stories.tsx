import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  simpleMarkdown,
  richMarkdown,
  inlineFormattingMarkdown,
  codeBlocksMarkdown,
  shortMarkdown,
  emptyMarkdown,
  generateLongMarkdown,
} from '../../../.storybook/mocks/mockMarkdown';

const meta = {
  title: 'Shared/MarkdownRenderer',
  component: MarkdownRenderer,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    children: { control: 'text' },
  },
  args: {
    children: shortMarkdown,
  },
} satisfies Meta<typeof MarkdownRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: shortMarkdown,
  },
};

export const Simple: Story = {
  args: {
    children: simpleMarkdown,
  },
};

export const Rich: Story = {
  args: {
    children: richMarkdown,
  },
};

export const InlineFormatting: Story = {
  args: {
    children: inlineFormattingMarkdown,
  },
};

export const CodeBlocks: Story = {
  args: {
    children: codeBlocksMarkdown,
  },
};

/** The same renderer inside a tinted user bubble: code and chips stay in the palette. */
export const InUserBubble: Story = {
  args: {
    children: codeBlocksMarkdown,
    className: 'on-muted-surface bg-muted p-3 rounded-xl',
  },
};

export const Empty: Story = {
  args: {
    children: emptyMarkdown,
  },
};

export const LongContent: Story = {
  args: {
    children: generateLongMarkdown(10),
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-8 max-w-2xl">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Simple</h3>
        <MarkdownRenderer>{simpleMarkdown}</MarkdownRenderer>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">In a user bubble</h3>
        <MarkdownRenderer className="on-muted-surface bg-muted p-3 rounded-xl">
          {richMarkdown}
        </MarkdownRenderer>
      </div>
    </div>
  ),
};
