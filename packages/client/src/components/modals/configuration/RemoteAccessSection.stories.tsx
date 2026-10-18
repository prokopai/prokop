import type { Meta, StoryObj } from '@storybook/react-vite';
import { RemoteAccessSection } from './RemoteAccessSection';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createRemoteAccessStatus } from '../../../../.storybook/mocks/mockSettings';

/** Listen on the network, saved and suggested addresses, Tailscale sharing. */

const meta = {
  title: 'Settings/RemoteAccessSection',
  component: RemoteAccessSection,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background p-4"><Story /></div>],
} satisfies Meta<typeof RemoteAccessSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LocalOnly: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { remoteAccess: { status: async () => createRemoteAccessStatus({ listenOnNetwork: false, bindHost: '127.0.0.1', addresses: [], suggestions: [{ url: 'http://192.168.1.20:8742', kind: 'lan' as never }], tailscale: { installed: false, running: false, dnsName: null, serving: false, url: null } }) } } }) },
};

export const LockedByEnvironment: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { remoteAccess: { status: async () => createRemoteAccessStatus({ bindLockedByEnvironment: true }) } } }) },
};

export const NoTailscale: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { remoteAccess: { status: async () => createRemoteAccessStatus({ suggestions: [], tailscale: { installed: false, running: false, dnsName: null, serving: false, url: null } }) } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { remoteAccess: { status: async () => { throw new Error('Remote access settings are unavailable on this server'); } } } }) },
};
