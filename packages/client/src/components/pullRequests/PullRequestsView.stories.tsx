import type { Meta, StoryObj } from '@storybook/react-vite';
import { PullRequestsView } from './PullRequestsView';
import { usePrDrafts } from './shared';
import { createFakeSdkClient, type FakeHttp } from '../../../.storybook/harness';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { withServerDataStore, withSessionStore } from '../../../.storybook/mocks/storeDecorators';
import { createPullRequestDiscovery, createPullRequestList, createPullRequestRepository } from '../../../.storybook/mocks/mockGit';

/**
 * The Pull requests view: checkout picker, repository connection, inbox of
 * open PRs, and the open PR. Discovery, list and detail come from the fake
 * server.
 */

const workspace = createWorkspace({ id: 'ws-1', name: 'app', path: '/home/user/app' });

function client(http: FakeHttp = {}) {
  return createFakeSdkClient({ workspace, http });
}

const meta = {
  title: 'Files & Git/PullRequestsView',
  component: PullRequestsView,
  parameters: { layout: 'fullscreen' },
  args: { client: client(), serverId: 'story-server', workspaceId: workspace.id },
  decorators: [
    (Story) => { usePrDrafts.setState({ values: {} }); return <div className="flex h-screen flex-col overflow-hidden bg-background"><Story /></div>; },
    withServerDataStore({ workspaces: [workspace], activeWorkspaceId: workspace.id }),
    withSessionStore({ sessions: [] }),
  ],
} satisfies Meta<typeof PullRequestsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {};

export const EmptyInbox: Story = {
  args: { client: client({ pullRequests: { list: async () => createPullRequestList(0) } }) },
};

export const ManyPages: Story = {
  args: { client: client({ pullRequests: { list: async (_w, _s, _state, page = 1) => createPullRequestList(20, { nextPage: page < 3 ? page + 1 : null }) } }) },
};

export const NoRemoteConnection: Story = {
  args: { client: client({ pullRequests: { discover: async () => createPullRequestDiscovery({ connections: [] }) } }) },
};

export const ConnectionUnavailable: Story = {
  args: {
    client: client({
      pullRequests: {
        discover: async () => createPullRequestDiscovery({
          connections: [{
            repository: createPullRequestRepository({ provider: 'azure', host: 'dev.azure.com', owner: 'org', project: 'project', key: 'azure:org/project/app', url: 'https://dev.azure.com/org/project/_git/app' }),
            status: 'unavailable',
            message: 'Sign in to the Azure DevOps tenant to list pull requests.',
            command: 'az login --tenant contoso.onmicrosoft.com',
          }],
        }),
      },
    }),
  },
};

export const SeveralRemotes: Story = {
  args: {
    client: client({
      pullRequests: {
        discover: async () => createPullRequestDiscovery({
          connections: [
            { repository: createPullRequestRepository(), status: 'connected', accountId: 'acct-1', accountName: 'daniel' },
            { repository: createPullRequestRepository({ key: 'github:daniel/app', remote: 'fork', owner: 'daniel', url: 'https://github.com/daniel/app' }), status: 'connected', accountId: 'acct-1', accountName: 'daniel' },
          ],
        }),
      },
    }),
  },
};

export const DetachedHead: Story = {
  args: { client: client({ pullRequests: { discover: async () => createPullRequestDiscovery({ branch: null }) } }) },
};

export const Loading: Story = {
  args: { client: createFakeSdkClient({ workspace, latencyMs: 60_000 }) },
};

export const DiscoveryFails: Story = {
  args: { client: client({ pullRequests: { discover: async () => { throw new Error('fatal: not a git repository'); } } }) },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
