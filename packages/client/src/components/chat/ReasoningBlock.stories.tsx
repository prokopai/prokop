import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReasoningBlock } from './ReasoningBlock';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';

/** Finished reasoning, folded to one line. Click to open. */

const reasoning = `The user wants an architectural overview. I should look at the project structure, dependencies and code organization.

1. Read the package manifests.
2. Map the entry points.
3. Summarize the layering.`;

const meta = {
  title: 'Chat/ReasoningBlock',
  component: ReasoningBlock,
  parameters: { layout: 'padded' },
  args: {
    expansionKey: 'reasoning-story',
    children: <MarkdownRenderer>{reasoning}</MarkdownRenderer>,
  },
  decorators: [(Story) => <div className="max-w-2xl"><Story /></div>],
} satisfies Meta<typeof ReasoningBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithoutDuration: Story = {};

export const Seconds: Story = {
  args: { expansionKey: 'reasoning-seconds', durationMs: 4_200 },
};

export const Minutes: Story = {
  args: { expansionKey: 'reasoning-minutes', durationMs: 154_000 },
};
