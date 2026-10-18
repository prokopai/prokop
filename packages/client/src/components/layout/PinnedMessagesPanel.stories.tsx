import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PinnedMessagesPanel } from './PinnedMessagesPanel';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createPinnedMessage } from '../../../.storybook/mocks/mockSidebar';

/** Pinned messages of the workspace in the sidebar; renders nothing when there are none. */

const pins = [
  createPinnedMessage({ sessionId: 'sess-current', sessionTitle: 'Refactor the auth module' }),
  createPinnedMessage({ sessionTitle: 'Deployment checklist', preview: '1. Run migrations\n2. Warm caches\n3. Flip the feature flag' }),
  createPinnedMessage({ sessionTitle: null, preview: 'A pin from an untitled session with a very long preview that should truncate after a couple of lines so the sidebar stays tidy.' }),
];

function clientWith(pinnedMessages: typeof pins, latencyMs = 0) {
  return createFakeSdkClient({ latencyMs, http: { workspaces: { listPinnedMessages: async () => ({ pinnedMessages }) } } });
}

const meta = {
  title: 'Sessions/PinnedMessagesPanel',
  component: PinnedMessagesPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: clientWith(pins), workspaceId: 'ws-1', currentSessionId: 'sess-current', onNavigateToPinnedMessage: fn() },
  decorators: [(Story) => <div className="w-80 rounded-xl border bg-sidebar p-1 text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof PinnedMessagesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Many: Story = {
  args: { sdkClient: clientWith(Array.from({ length: 20 }, (_, i) => createPinnedMessage({ sessionTitle: `Session ${i + 1}`, preview: `Pinned note number ${i + 1}` }))) },
};

export const Empty: Story = {
  args: { sdkClient: clientWith([]) },
};

export const Loading: Story = {
  args: { sdkClient: clientWith(pins, 60_000) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
