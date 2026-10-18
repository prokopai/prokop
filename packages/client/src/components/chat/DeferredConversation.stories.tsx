import type { Meta, StoryObj } from '@storybook/react-vite';
import { DeferredConversation } from './DeferredConversation';

/** Defers heavy transcript children until after first paint. Children appear after a frame. */

const meta = {
  title: 'Chat/DeferredConversation',
  component: DeferredConversation,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DeferredConversation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="rounded-lg border p-4 text-sm">
        Deferred content. It mounted one frame after the parent.
      </div>
    ),
  },
};
