import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SessionCategoryStatus } from './SessionCategoryStatus';

/** Loading, error and "load more" rows under a session category list. */

type Category = NonNullable<Parameters<typeof SessionCategoryStatus>[0]['category']>;

function category(overrides: Partial<Category>): Category {
  return { isLoading: false, error: null, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: fn(), loadedCount: 20, retry: fn(), open: true, onOpenChange: fn(), ...overrides } as Category;
}

const meta = {
  title: 'Sessions/SessionCategoryStatus',
  component: SessionCategoryStatus,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-80 rounded-xl border bg-sidebar p-1 text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof SessionCategoryStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { category: category({ isLoading: true }) } };
export const Failed: Story = { args: { category: category({ error: 'Network error' }) } };
export const LoadMore: Story = { args: { category: category({ hasNextPage: true }) } };
export const LoadingMore: Story = { args: { category: category({ hasNextPage: true, isFetchingNextPage: true }) } };
export const Settled: Story = { args: { category: category({}) } };
export const NoCategory: Story = { args: { category: undefined } };
