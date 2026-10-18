import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProviderCredentialsPanel } from './ProviderCredentialsPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';

/** API keys per provider: set, replace, clear. */

const meta = {
  title: 'Settings/ProviderCredentialsPanel',
  component: ProviderCredentialsPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof ProviderCredentialsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Embedded: Story = {
  args: { embedded: true },
};

export const SingleProvider: Story = {
  args: { provider: 'openai', embedded: true },
};

export const NoneConfigured: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { providers: { listCredentials: async () => ({ providers: ['anthropic', 'openai', 'google'].map((provider) => ({ provider, configured: false })) }) } } }) },
};

export const SaveFails: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { providers: { setCredential: async () => { throw new Error('The key was rejected by the provider.'); } } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
