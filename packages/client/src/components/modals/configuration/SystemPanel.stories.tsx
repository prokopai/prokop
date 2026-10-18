import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SystemPanel } from './SystemPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';

/** Connection and version: how this device is authenticated, logout, server and client versions. */

const meta = {
  title: 'Settings/SystemPanel',
  component: SystemPanel,
  parameters: { layout: 'padded' },
  args: { apiToken: 'pkd_3f9a2c7e1b4d8e6f', isConnected: true, onLogout: fn(), sdkClient: createFakeSdkClient(), open: true },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof SystemPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PairedDevice: Story = {};
export const SharedToken: Story = { args: { apiToken: 'a-very-long-shared-auth-token-value' } };
export const ThisComputer: Story = { args: { apiToken: null } };
export const Disconnected: Story = { args: { isConnected: false, sdkClient: null } };
export const UpdateAvailable: Story = { args: { sdkClient: createFakeSdkClient({ rawGet: async (path) => (path === '/info' ? { version: '1.22.0' } : {}) }) } };
