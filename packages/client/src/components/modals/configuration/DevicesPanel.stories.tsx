import type { Meta, StoryObj } from '@storybook/react-vite';
import { DevicesPanel } from './DevicesPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createAccessOverview, createAccessStatus } from '../../../../.storybook/mocks/mockSettings';

/** Paired devices, pending approvals, pairing codes and remote access, from the server's own machine or a paired device. */

const meta = {
  title: 'Settings/DevicesPanel',
  component: DevicesPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="h-[36rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof DevicesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Admin: Story = {};

export const NoDevicesOrRequests: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { access: { overview: async () => createAccessOverview({ requests: [], devices: [] }) } } }) },
};

export const PairedDevice: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { access: { status: async () => createAccessStatus({ admin: false, access: 'device', device: { id: 'device-self', label: 'iPhone' }, addresses: undefined }) } } }) },
};

export const SharedToken: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { access: { status: async () => createAccessStatus({ admin: false, access: 'token', device: null, pairingMethods: [] }) } } }) },
};

export const OpenAccess: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { access: { status: async () => createAccessStatus({ access: 'open', pairingMethods: [] }) } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { access: { status: async () => { throw new Error('401 Unauthorized'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
