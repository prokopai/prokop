import type { Meta, StoryObj } from '@storybook/react-vite';
import { HtmlRenderFrame } from './HtmlRenderFrame';
import { withSdkClient } from '../../../.storybook/harness';

/**
 * An agent's HTML page inline in the conversation, in a sandboxed iframe on
 * an opaque origin. There is no server in Storybook, so the frame stays at the
 * agent's estimated height; this story shows the chrome around it.
 */

const meta = {
  title: 'Visualizations/HtmlRenderFrame',
  component: HtmlRenderFrame,
  parameters: { layout: 'padded' },
  decorators: [withSdkClient()],
  args: {
    render: {
      sessionId: 'story-session',
      attachmentId: 'att-1',
      accessKey: 'key',
      title: 'Token usage by day',
      height: 320,
    },
  },
} satisfies Meta<typeof HtmlRenderFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tall: Story = {
  args: { render: { sessionId: 'story-session', attachmentId: 'att-2', accessKey: 'key', title: 'Full report', height: 900 } },
};

export const Short: Story = {
  args: { render: { sessionId: 'story-session', attachmentId: 'att-3', accessKey: 'key', title: 'Badge', height: 40 } },
};
