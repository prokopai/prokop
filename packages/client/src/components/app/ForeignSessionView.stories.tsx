import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ForeignSessionView } from './ForeignSessionView';
import { useHostClientStore, type HostClientStatus } from '@/lib/hostClientPool';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { createFakeSdkClient, workspaceScene, storyServer } from '../../../.storybook/harness';
import { createSession } from '../../../.storybook/mocks/mockSession';

/**
 * A session from another machine as a tab on this board. The pool connects
 * to that machine in the background; here its status is seeded, so the
 * "connecting" and "offline" states appear as the pool reports them.
 */

const laptop = { ...storyServer, id: 'laptop', name: 'Laptop', url: 'https://laptop.storybook.local' };
const remote = createSession({ id: 'remote-1', workspaceId: 'remote-ws', title: 'Long refactor on the laptop' });

function withHost(status: HostClientStatus | null, connected = false) {
  return function HostDecorator(Story: ComponentType) {
    useForeignSessionsStore.setState({ byId: { [remote.id]: { serverId: laptop.id, session: remote } } } as never);
    useHostClientStore.setState({
      clients: connected ? { [laptop.id]: createFakeSdkClient() } : {},
      urls: connected ? { [laptop.id]: laptop.url } : {},
      status: status ? { [laptop.id]: status } : {},
    });
    return <Story />;
  };
}

const meta = {
  title: 'Workspace/ForeignSessionView',
  component: ForeignSessionView,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: the host pool connects to the other machine on mount; happy-dom aborts the pending request at teardown',
  },
  args: { serverId: laptop.id, sessionId: remote.id },
  decorators: [
    (Story) => <div className="flex h-screen flex-col overflow-hidden bg-background"><Story /></div>,
    ...workspaceScene({ sessions: [], contexts: { server: { servers: [storyServer, laptop] } } }),
  ],
} satisfies Meta<typeof ForeignSessionView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {
  decorators: [withHost('connected', true)],
};

export const Connecting: Story = {
  decorators: [withHost('connecting')],
};

export const Offline: Story = {
  decorators: [withHost('offline')],
};

export const Unpaired: Story = {
  decorators: [withHost('unpaired')],
};

export const MachineNotSaved: Story = {
  args: { serverId: 'forgotten' },
  decorators: [withHost(null)],
};
