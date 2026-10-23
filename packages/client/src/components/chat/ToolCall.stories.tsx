import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ToolCall } from './ToolCall';
import {
  createToolPart,
  createToolStatePending,
  createToolStateRunning,
  createToolStateCompleted,
  createToolStateError,
  createToolStateInterrupted,
} from '../../../.storybook/mocks/mockMessage';
import { withSessionStore } from '../../../.storybook/mocks/storeDecorators';

const pendingPart = createToolPart(
  { name: 'read-file', callId: 'call-pending' },
  createToolStatePending({ input: { path: '/src/index.ts' } }),
);

const runningPart = createToolPart(
  { name: 'shell', callId: 'call-running' },
  createToolStateRunning({ input: { command: 'npm run build' } }),
);

const completedPart = createToolPart(
  { name: 'read-file', callId: 'call-completed' },
  createToolStateCompleted({
    input: { path: '/src/index.ts' },
    output: { success: true, content: 'export { main } from "./main";\nexport { config } from "./config";' },
  }),
);

const errorPart = createToolPart(
  { name: 'shell', callId: 'call-error' },
  createToolStateError({
    input: { command: 'npm run build' },
    error: 'Build failed with 12 TypeScript errors.',
  }),
);

const interruptedPart = createToolPart(
  { name: 'shell', callId: 'call-interrupted' },
  createToolStateInterrupted({
    input: { command: 'npm run test' },
  }),
);

const largeOutputPart = createToolPart(
  { name: 'read-file', callId: 'call-large' },
  createToolStateCompleted({
    input: { path: '/src/large-file.ts' },
    output: { success: true, content: 'Line 1\n'.repeat(200) },
  }),
);

const CHILD_SESSION_ID = '11111111-2222-4333-8444-555555555555';
const delegateInput = { description: 'Review the auth change', prompt: 'Review the diff on this branch.', subagent_type: 'reviewer' };

// A delegation still running in wait mode: spinner and elapsed time, no link yet.
const delegateRunningPart = createToolPart(
  { name: 'delegate_task', callId: 'call-delegate' },
  createToolStateRunning({ input: delegateInput }),
);

// A finished delegation on any harness: the server projects the child link and the row state onto the part.
const delegateCompletedPart = createToolPart(
  {
    name: 'delegate_task',
    callId: 'call-delegate-done',
    presentation: {
      summary: 'Review the auth change',
      visualization: { type: 'none', badge: 'completed', message: 'Two findings, both in token refresh.' },
      debugAvailable: true,
    },
  },
  {
    ...createToolStateCompleted({
      input: delegateInput,
      output: JSON.stringify({ task_id: CHILD_SESSION_ID, result: 'Two findings, both in token refresh.\n\n1. ...', harness: 'claude-cli' }),
    }),
    childSessionId: CHILD_SESSION_ID,
  },
);

// A transcript from before the rename: the Prokop `task` row with its task_id line keeps its link.
const legacyTaskPart = createToolPart(
  { name: 'task', callId: 'call-task-legacy' },
  createToolStateCompleted({
    input: { prompt: 'Explore the codebase structure' },
    output: `<task_result>\nThe entry point is src/index.ts.\n</task_result>\ntask_id: ${CHILD_SESSION_ID} (for resuming to continue this task if needed)`,
  }),
);

const meta = {
  title: 'Chat/ToolCall',
  component: ToolCall,
  parameters: {
    layout: 'padded',
  },
  decorators: [withSessionStore()],
  args: {
    sessionId: 'session-1',
    onNavigateToSubagent: fn(),
  },
} as Meta<typeof ToolCall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  args: {
    part: pendingPart,
  },
};

export const Running: Story = {
  args: {
    part: runningPart,
  },
};

export const Completed: Story = {
  args: {
    part: completedPart,
  },
};

export const CompletedExpanded: Story = {
  args: {
    part: completedPart,
  },
};

export const Error: Story = {
  args: {
    part: errorPart,
  },
};

export const ErrorExpanded: Story = {
  args: {
    part: errorPart,
  },
};

export const Interrupted: Story = {
  args: {
    part: interruptedPart,
  },
};

export const LargeOutput: Story = {
  args: {
    part: largeOutputPart,
  },
};

export const DelegateTaskRunning: Story = {
  args: {
    part: delegateRunningPart,
  },
};

export const DelegateTaskCompletedWithLink: Story = {
  args: {
    part: delegateCompletedPart,
  },
};

export const LegacyTaskRowKeepsLink: Story = {
  args: {
    part: legacyTaskPart,
  },
};

export const MultipleToolCalls: Story = {
  args: {
    part: completedPart,
    onNavigateToSubagent: fn(),
  },
  render: (args) => (
    <div className="max-w-2xl space-y-2">
      <ToolCall {...args} part={pendingPart} />
      <ToolCall {...args} part={runningPart} />
      <ToolCall {...args} part={completedPart} />
      <ToolCall {...args} part={errorPart} />
      <ToolCall {...args} part={interruptedPart} />
    </div>
  ),
};
