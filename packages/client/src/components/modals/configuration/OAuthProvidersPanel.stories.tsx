import type { Meta, StoryObj } from '@storybook/react-vite';
import { OAuthProvidersPanel } from './OAuthProvidersPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createOAuthProviders } from '../../../../.storybook/mocks/mockSettings';

/** OAuth subscriptions (ChatGPT for Codex, Gmail, GitHub): connect, several accounts, reauth, disconnect. */

const meta = {
  title: 'Settings/OAuthProvidersPanel',
  component: OAuthProvidersPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof OAuthProvidersPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Embedded: Story = {
  args: { embedded: true },
};

export const SingleProvider: Story = {
  args: { provider: 'codex', embedded: true },
};

export const NothingConnected: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { providers: { list: async () => ({ providers: createOAuthProviders().map((item) => ({ ...item, connected: false, accounts: [], activeAccountId: null, reauthRequired: false, error: undefined })) }) } } }) },
};

export const ConnectStarted: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { providers: { list: async () => ({ providers: createOAuthProviders().map((item) => (item.provider === 'gmail' ? { ...item, authorizationUrl: 'https://accounts.google.com/o/oauth2/auth?client_id=demo', flowId: 'flow-1', redirectStrategy: 'manual' } : item)) }) } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { providers: { list: async () => { throw new Error('Provider registry unavailable'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
