import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { GitChangesActions } from './GitChangesActions';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createGitRepository, createGitStatus } from '../../../.storybook/mocks/mockGit';

/**
 * Commit and push controls under the Changes list: pick files, write a
 * message, commit, push with or without hooks, see Git output on failure.
 */

const files = createGitStatus().files;

const meta = {
  title: 'Files & Git/GitChangesActions',
  component: GitChangesActions,
  parameters: { layout: 'fullscreen' },
  args: { sdkClient: createFakeSdkClient(), workspaceId: 'ws-1', serverId: 'story-server', files, onPreview: fn() },
  decorators: [(Story) => <div className="flex h-screen w-80 flex-col justify-end border-r bg-sidebar text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof GitChangesActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithUpstream: Story = {};

export const NoUpstream: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitRepository: async () => createGitRepository({ upstream: null }) } } }) },
};

export const SeveralRemotes: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitRepository: async () => createGitRepository({ upstream: null, remotes: ['origin', 'upstream', 'fork'] }) } } }) },
};

export const NoRemotes: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitRepository: async () => createGitRepository({ upstream: null, remotes: [] }) } } }) },
};

export const DetachedHead: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitRepository: async () => createGitRepository({ branch: null, upstream: null }) } } }) },
};

export const CommitFails: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitCommit: async () => { throw new Error('pre-commit hook failed: lint errors in src/auth/session.ts'); } } } }) },
};

export const PushRejected: Story = {
  args: {
    sdkClient: createFakeSdkClient({
      http: {
        files: {
          gitCommit: async () => ({ head: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3' }),
          gitPush: async () => { throw new Error('Updates were rejected because the remote contains work that you do not have locally.'); },
        },
      },
    }),
  },
};

export const OnlyConflictedFiles: Story = {
  args: { files: [{ path: 'src/auth/session.ts', git: { status: 'conflicted', staged: false, unstaged: true } }] },
};

export const NoChanges: Story = {
  args: { files: [] },
};
