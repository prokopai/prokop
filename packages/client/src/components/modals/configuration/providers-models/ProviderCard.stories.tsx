import { SettingsGroup } from '@/components/ui/settings-group';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProviderCard } from './ProviderCard';
import { createFakeSdkClient } from '../../../../../.storybook/harness';
import { createModelsConfig, createOAuthProviders } from '../../../../../.storybook/mocks/mockSettings';

/** One provider in the Providers & Models panel: status, credential, models, add and edit. */

const config = createModelsConfig();
const anthropic = config.providers.find((p) => p.id === 'anthropic') ?? config.providers[0]!;
const openai = config.providers.find((p) => p.id === 'openai') ?? config.providers[1] ?? anthropic;
const codex = createOAuthProviders()[0]!;

const meta = {
  title: 'Settings/ProviderCard',
  component: ProviderCard,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient(), provider: anthropic, defaultProvider: config.defaultProvider, defaultModel: config.defaultModel, credential: { provider: anthropic.id, configured: true } },
  decorators: [(Story) => <div className="w-[36rem]"><SettingsGroup label="Providers"><Story /></SettingsGroup></div>],
} satisfies Meta<typeof ProviderCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectedWithDefault: Story = {};

export const NoCredential: Story = {
  args: { provider: openai, credential: { provider: openai.id, configured: false } },
};

export const OAuthConnected: Story = {
  args: { provider: { id: 'codex', name: 'ChatGPT (Codex)', models: [] }, credential: undefined, oauth: codex },
};

export const OAuthReconnect: Story = {
  args: { provider: { id: 'codex', name: 'ChatGPT (Codex)', models: [] }, credential: undefined, oauth: { ...codex, reauthRequired: true } },
};

export const NoModels: Story = {
  args: { provider: { ...openai, models: [] }, credential: { provider: openai.id, configured: true } },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
