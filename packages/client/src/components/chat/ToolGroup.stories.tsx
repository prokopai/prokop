import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToolGroup } from './ToolGroup';
import { ToolCall } from './ToolCall';
import {
  createToolPart,
  createToolStateCompleted,
  createToolStateError,
  createToolStateRunning,
} from '../../../.storybook/mocks/mockMessage';
import { withSessionStore } from '../../../.storybook/mocks/storeDecorators';

/**
 * One folded row for a run of tool calls. Open while live, folded once done.
 * Only failures take color; edits show their line counts.
 */

const read = createToolPart({ name: 'read-file', callId: 'g-read' }, createToolStateCompleted({ input: { path: 'src/index.ts' }, output: { success: true, content: 'export {};' } }));
const grep = createToolPart({ name: 'grep', callId: 'g-grep' }, createToolStateCompleted({ input: { pattern: 'useSession' }, output: { success: true, content: '3 matches' } }));
const edit = createToolPart({ name: 'edit', callId: 'g-edit' }, createToolStateCompleted({
  input: { path: 'src/index.ts' },
  output: { success: true, content: 'ok', _visualization: { type: 'diff', path: 'src/index.ts', additions: 4, deletions: 1, hunks: [] } },
}));
const failed = createToolPart({ name: 'shell', callId: 'g-shell' }, createToolStateError({ input: { command: 'bun test' }, error: '1 test failed' }));
const running = createToolPart({ name: 'shell', callId: 'g-run' }, createToolStateRunning({ input: { command: 'bun run build' } }));

function Rows({ parts }: { parts: ReturnType<typeof createToolPart>[] }) {
  return (
    <>
      {parts.map((part) => <ToolCall key={part.id} part={part} sessionId="story-session" />)}
    </>
  );
}

const meta = {
  title: 'Chat/ToolGroup',
  component: ToolGroup,
  parameters: { layout: 'padded' },
  decorators: [withSessionStore(), (Story) => <div className="max-w-2xl"><Story /></div>],
} satisfies Meta<typeof ToolGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Finished: Story = {
  args: { expansionKey: 'group-finished', parts: [read, read, grep, edit], live: false, children: <Rows parts={[read, read, grep, edit]} /> },
};

export const Live: Story = {
  args: { expansionKey: 'group-live', parts: [read, grep, running], live: true, children: <Rows parts={[read, grep, running]} /> },
};

export const WithFailure: Story = {
  args: { expansionKey: 'group-failed', parts: [read, failed], live: false, children: <Rows parts={[read, failed]} /> },
};

export const SingleCall: Story = {
  args: { expansionKey: 'group-single', parts: [grep], live: false, children: <Rows parts={[grep]} /> },
};
