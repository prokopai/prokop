import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { OtherMachinesOverview } from './OtherMachinesOverview';
import { useAttentionStore } from '@/lib/attention';
import { withAppContexts, withMemoryRouter, STORY_ROUTES, storyServer } from '../../../.storybook/harness';
import { createAttentionSnapshot } from '../../../.storybook/mocks/mockSidebar';

/**
 * Sessions on other saved machines that run or need you, at the top of the
 * Overview. Hidden when nothing happens elsewhere.
 */

const laptop = { ...storyServer, id: 'laptop', name: 'Laptop' };
const office = { ...storyServer, id: 'office', name: 'Office desktop' };

function withAttention(hosts: Record<string, ReturnType<typeof createAttentionSnapshot> | null>) {
  return function AttentionDecorator(Story: ComponentType) {
    useAttentionStore.setState({
      hosts: Object.fromEntries(Object.entries(hosts).map(([id, snapshot]) => [id, { connection: snapshot ? 'live' : 'offline', snapshot }])),
    });
    return <Story />;
  };
}

const meta = {
  title: 'Sessions/OtherMachinesOverview',
  component: OtherMachinesOverview,
  parameters: { layout: 'padded' },
  args: { activeServerId: storyServer.id },
  decorators: [
    (Story) => <div className="w-80 rounded-xl border bg-sidebar p-1 text-sidebar-foreground"><Story /></div>,
    withMemoryRouter(STORY_ROUTES.overview),
    withAppContexts({ server: { servers: [storyServer, laptop, office] } }),
  ],
} satisfies Meta<typeof OtherMachinesOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WaitingAndRunning: Story = {
  decorators: [withAttention({ laptop: createAttentionSnapshot(), office: createAttentionSnapshot({ asks: [], running: [{ sessionId: 'o-1', sessionTitle: null, workspaceId: 'w', workspaceName: null, runningAt: new Date().toISOString() }] }) })],
};

export const OnlyRunning: Story = {
  decorators: [withAttention({ laptop: createAttentionSnapshot({ asks: [] }) })],
};

export const NothingElsewhere: Story = {
  decorators: [withAttention({ laptop: createAttentionSnapshot({ asks: [], running: [] }), office: null })],
};
