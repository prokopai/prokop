import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PullRequestCreateForm } from './PullRequestCreateForm';
import { usePrDrafts, type PullRequestContext } from './shared';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createPullRequestDetail } from '../../../.storybook/mocks/mockGit';

/** The new pull request form: title, body, source and target branch, draft or ready. */

function ctx(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    client: createFakeSdkClient(),
    serverId: 'story-server',
    workspaceId: 'ws-1',
    scope: { remote: 'origin', repositoryKey: 'github:acme/app' },
    accountId: 'acct-1',
    provider: 'github',
    ...overrides,
  };
}

const meta = {
  title: 'Files & Git/PullRequestCreateForm',
  component: PullRequestCreateForm,
  parameters: { layout: 'padded' },
  args: { ctx: ctx(), branch: 'feature/login', onCreated: fn(), onCancel: fn() },
  decorators: [(Story) => { usePrDrafts.setState({ values: {} }); return <div className="mx-auto max-w-3xl"><Story /></div>; }],
} satisfies Meta<typeof PullRequestCreateForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithDraft: Story = {
  decorators: [(Story) => {
    usePrDrafts.setState({ values: {
      'story-server:ws-1:github:acme/app:create:title': 'auth: validate the exp claim',
      'story-server:ws-1:github:acme/app:create:body': 'Tokens without `exp` were accepted.\n\n- [x] tests',
      'story-server:ws-1:github:acme/app:create:target': 'main',
    } });
    return <Story />;
  }],
};

export const CreateFails: Story = {
  args: { ctx: ctx({ client: createFakeSdkClient({ http: { pullRequests: { create: async () => { throw new Error('A pull request for feature/login already exists.'); } } } }) }) },
};

export const CreateSucceeds: Story = {
  args: { ctx: ctx({ client: createFakeSdkClient({ http: { pullRequests: { create: async () => createPullRequestDetail({ number: 42 }) } } }) }) },
};

export const Azure: Story = {
  args: { ctx: ctx({ provider: 'azure', scope: { remote: 'origin', repositoryKey: 'azure:org/project/app' } }) },
};
