import type { Meta, StoryObj } from '@storybook/react-vite';
import { UsagePanel } from './UsagePanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createCodexAccountUsage, createHarnessUsage, createProviderUsage } from '../../../../.storybook/mocks/mockSettings';

/** Plan windows and balances for the harness CLIs, Codex accounts and metered providers. */

const meta = {
  title: 'Settings/UsagePanel',
  component: UsagePanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="h-[36rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof UsagePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NearLimits: Story = {
  args: {
    sdkClient: createFakeSdkClient({
      http: {
        sessions: { harnessUsage: async (harness) => ({ usage: createHarnessUsage({ harness: harness as 'claude-cli', windows: [{ id: 'five_hour', kind: 'session', label: '5 hours', usedPercent: 97, resetsAt: new Date(Date.now() + 600_000).toISOString() }, { id: 'weekly', kind: 'weekly', label: 'Week', usedPercent: 100 }] }) }) },
        providers: {
          codexAccountUsage: async (accountId) => ({ usage: createCodexAccountUsage({ accountId, windows: [{ id: 'five_hour', label: '5 hours', usedPercent: 100, resetsAt: new Date(Date.now() + 1_200_000).toISOString() }] }) }),
          usage: async (provider) => ({ usage: createProviderUsage({ provider: provider as 'deepseek', balances: [{ currency: 'USD', remaining: '0.12' }] }) }),
        },
      },
    }),
  },
};

export const Unavailable: Story = {
  args: {
    sdkClient: createFakeSdkClient({
      http: {
        sessions: { harnessUsage: async (harness) => ({ usage: createHarnessUsage({ harness: harness as 'claude-cli', plan: null, windows: [], unavailable: { reason: 'unsupported', message: 'API key accounts have no plan limits.' } }) }) },
        providers: {
          codexAccountUsage: async (accountId) => ({ usage: createCodexAccountUsage({ accountId, windows: [], unavailable: { reason: 'probeFailed', message: 'Codex did not answer in time.' } }) }),
          usage: async (provider) => ({ usage: createProviderUsage({ provider: provider as 'deepseek', windows: [], balances: [], unavailable: { reason: 'notConfigured', message: 'Add an API key first.' } }) }),
        },
      },
    }),
  },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { sessions: { harnessUsage: async () => { throw new Error('claude usage probe failed'); } }, providers: { usage: async () => { throw new Error('502'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
