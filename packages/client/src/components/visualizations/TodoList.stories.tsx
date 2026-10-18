import type { Meta, StoryObj } from '@storybook/react-vite';
import { TodoList } from './TodoList';

/** The agent's task list, one row per item with status and priority. */

const meta = {
  title: 'Visualizations/TodoList',
  component: TodoList,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TodoList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Plan',
    items: [
      { content: 'Read the existing auth module', status: 'completed', priority: 'high' },
      { content: 'Add TypeScript types to session helpers', status: 'in_progress', priority: 'high' },
      { content: 'Write unit tests for token refresh', status: 'pending', priority: 'medium' },
      { content: 'Update the README', status: 'pending', priority: 'low' },
      { content: 'Migrate the legacy cookie format', status: 'cancelled', priority: 'low' },
    ],
  },
};

export const AllDone: Story = {
  args: {
    items: [
      { content: 'Read the existing auth module', status: 'completed', priority: 'high' },
      { content: 'Add types', status: 'completed', priority: 'medium' },
    ],
  },
};

export const LongItems: Story = {
  args: {
    items: [
      { content: 'Investigate why the terminal resize observer fires twice on Safari when the dock is collapsed and the window is resized below the mobile breakpoint, then write a regression test', status: 'in_progress', priority: 'high' },
      { content: 'Short one', status: 'pending', priority: 'low' },
    ],
  },
};

export const Empty: Story = {
  args: { title: 'Plan', items: [] },
};
