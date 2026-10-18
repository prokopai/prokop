import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProvidersModelsPanel } from './ProvidersModelsPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createModelsConfig } from '../../../../.storybook/mocks/mockSettings';

/** Provider cards with their models, credentials and OAuth state, plus the default model picker. */

const meta = {
  title: 'Settings/ProvidersModelsPanel',
  component: ProvidersModelsPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="h-[36rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof ProvidersModelsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoProviders: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { config: { models: { get: async () => createModelsConfig({ providers: [], defaultModel: '', defaultProvider: '' }) } } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { config: { models: { get: async () => { throw new Error('models.json is invalid JSON'); } } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
