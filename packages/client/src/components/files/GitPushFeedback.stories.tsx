import type { Meta, StoryObj } from '@storybook/react-vite';
import { GitOutput, PushProgress } from './GitPushFeedback';

/** Git output disclosure and the live push progress line. */

const output = `Enumerating objects: 12, done.
Counting objects: 100% (12/12), done.
Delta compression using up to 8 threads
Compressing objects: 100% (7/7), done.
Writing objects: 100% (7/7), 1.02 KiB | 1.02 MiB/s, done.
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: error: Required status check "test" is failing.
To github.com:acme/app.git
 ! [remote rejected] main -> main (protected branch hook declined)
error: failed to push some refs to 'github.com:acme/app.git'`;

const meta = {
  title: 'Files & Git/GitPushFeedback',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-80 rounded-xl border bg-sidebar p-2 text-sidebar-foreground"><Story /></div>],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Output: Story = {
  render: () => <GitOutput output={output} />,
};

export const NoOutput: Story = {
  render: () => <><GitOutput output={undefined} /><span className="text-xs text-muted-foreground">(renders nothing without output)</span></>,
};

export const PushingWithHooks: Story = {
  render: () => <PushProgress label="Pushing" startedAt={Date.now() - 42_000} runHooks />,
};

export const PushingWithoutHooks: Story = {
  render: () => <PushProgress label="Pushing" startedAt={Date.now() - 3_000} runHooks={false} />,
};

export const LongRunning: Story = {
  render: () => <PushProgress label="Force pushing" startedAt={Date.now() - 95_000} runHooks />,
};
