import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorktreeSetupLogDialog } from './WorktreeSetupLogDialog';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { worktreePresets } from '../../../.storybook/mocks/mockWorktree';

/** Output of a worktree's setup and teardown commands, opened from a worktree row. */

const log = [
  '# setup for fix-auth (wt-1) at 2026-10-22T09:00:00.000Z',
  '',
  '$ bun install',
  'bun install v1.4.0',
  ' + 412 packages installed [1.20s]',
  '',
  '$ bun run db:create',
  'error: database "app_fix_auth_1a2b3c" already exists',
  '',
  '# exit code 1',
].join('\n');

function clientWith(text: string) {
  return createFakeSdkClient({ http: { workspaces: { getWorktreeSetupLog: async () => ({ log: text }) } } });
}

const meta = {
  title: 'Files & Git/WorktreeSetupLogDialog',
  component: WorktreeSetupLogDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    sdkClient: clientWith(log),
    workspaceId: 'ws-1',
    worktree: worktreePresets.setupFailed,
    onClose: () => {},
  },
} satisfies Meta<typeof WorktreeSetupLogDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Failed: Story = {};

export const Running: Story = {
  args: { worktree: worktreePresets.settingUp, sdkClient: clientWith(log.split('\n$ bun run')[0] ?? '') },
};

export const Empty: Story = {
  args: { worktree: worktreePresets.needsApproval, sdkClient: clientWith('') },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};
