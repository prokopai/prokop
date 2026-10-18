import type { Meta, StoryObj } from '@storybook/react-vite';
import { PreconfigsPanel } from './PreconfigsPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { withServerDataStore } from '../../../../.storybook/mocks/storeDecorators';
import { createPreconfigList } from '../../../../.storybook/mocks/mockPreconfig';
import { createAgent } from '../../../../.storybook/mocks/mockSidebar';

/**
 * Agents (preconfigs): list, editor with prompt, tools, model, subagents,
 * capabilities, and promotion to an agent with a home. Click a row to open
 * the editor.
 */

const meta = {
  title: 'Settings/PreconfigsPanel',
  component: PreconfigsPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [withServerDataStore(), (Story) => <div className="h-[40rem] w-[44rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof PreconfigsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAgents: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { agents: { list: async () => ({ agents: [createAgent({ id: createPreconfigList()[1]?.id ?? 'agent-1', name: 'Code reviewer' })] }) } } }) },
};

export const Many: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { preconfigs: { list: async () => ({ preconfigs: Array.from({ length: 30 }, (_, i) => ({ ...createPreconfigList()[i % 4]!, id: `pre-${i}`, name: `Agent ${i + 1}`, isDefault: i === 0 })) }) } } }) },
};

export const Empty: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { preconfigs: { list: async () => ({ preconfigs: [] }) } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
