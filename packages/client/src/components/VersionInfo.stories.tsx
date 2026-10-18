import type { Meta, StoryObj } from '@storybook/react-vite';
import { VersionInfo } from './VersionInfo';
import { createFakeSdkClient } from '../../.storybook/harness';

/**
 * Client and server versions with the latest releases from GitHub. The
 * server version comes from the fake client; the latest versions come from
 * the network and may show as unavailable in Storybook.
 */

const meta = {
  title: 'Shell/VersionInfo',
  component: VersionInfo,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient(), enabled: true },
  decorators: [(Story) => <div className="w-[32rem] rounded-xl border bg-background p-4"><Story /></div>],
} satisfies Meta<typeof VersionInfo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OlderServer: Story = {
  args: { sdkClient: createFakeSdkClient({ rawGet: async (path) => (path === '/info' ? { version: '1.20.0' } : {}) }) },
};

export const ServerVersionUnknown: Story = {
  args: { sdkClient: createFakeSdkClient({ rawGet: async () => { throw new Error('no /info'); } }) },
};

export const Disabled: Story = {
  args: { enabled: false },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
