import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PlusIcon } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from './States';
import { Button } from '@/components/ui/button';

/** The three states every panel can be in. Settings, docks and dialogs all use these. */

const meta = {
  title: 'Shared/States',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[32rem] rounded-xl border bg-background p-3"><Story /></div>],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { render: () => <LoadingState /> };
export const LoadingWithLabel: Story = { render: () => <LoadingState label="Loading agents…" /> };
export const LoadingInline: Story = { render: () => <LoadingState inline label="Loading commit…" /> };

export const Error: Story = { render: () => <ErrorState>Could not load agents: Provider returned 503.</ErrorState> };
export const ErrorWithRetry: Story = { render: () => <ErrorState onRetry={fn()}>git status timed out after 30 seconds.</ErrorState> };
export const ErrorLong: Story = { render: () => <ErrorState onRetry={fn()}>fatal: unable to access 'https://github.com/acme/app.git/': Could not resolve host: github.com. Check the network connection on the machine running Prokop and try again.</ErrorState> };

export const Empty: Story = { render: () => <EmptyState>No prompts yet. Add one to reuse text in the composer.</EmptyState> };
export const EmptyWithAction: Story = {
  render: () => (
    <EmptyState action={<Button size="sm" variant="outline" onClick={fn()}><PlusIcon />Add agent</Button>}>
      No agents yet. Add one to give sessions a role.
    </EmptyState>
  ),
};
export const EmptyPlain: Story = {
  decorators: [(Story) => <div className="w-80 rounded-xl border bg-sidebar p-2 text-sidebar-foreground"><Story /></div>],
  render: () => <EmptyState variant="plain">No sessions yet.</EmptyState>,
};
