import type { Meta, StoryObj } from '@storybook/react-vite';
import { HarnessesPanel } from './HarnessesPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';

/** Which execution harnesses are installed and enabled: Prokop, Claude Code, Codex CLI. */

function clientWith(harnesses: Array<Record<string, unknown>>, latencyMs = 0) {
  return createFakeSdkClient({
    latencyMs,
    http: {
      sessions: {
        harnesses: async () => ({ harnesses: harnesses as never }),
        setHarnessEnabled: async (harness, enabled) => ({ harnesses: harnesses.map((item) => (item.id === harness ? { ...item, enabled } : item)) as never }),
      },
    },
  });
}

const meta = {
  title: 'Settings/HarnessesPanel',
  component: HarnessesPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof HarnessesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllInstalled: Story = {
  args: { sdkClient: clientWith([
    { id: 'prokop', available: true, enabled: true },
    { id: 'claude-cli', available: true, enabled: true, version: '2.0.14', approvals: true },
    { id: 'codex-cli', available: true, enabled: false, version: '0.45.0', approvals: true },
  ]) },
};

export const OnlyProkop: Story = {
  args: { sdkClient: clientWith([{ id: 'prokop', available: true, enabled: true }, { id: 'claude-cli', available: false, enabled: false, version: null }, { id: 'codex-cli', available: false, enabled: false, version: null }]) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { sessions: { harnesses: async () => { throw new Error('Could not read harness status'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
