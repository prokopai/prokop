import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ReconnectStatus } from './ReconnectStatus';
import { withConnectionStore } from '../../../.storybook/mocks/storeDecorators';

/** The small reconnect pill under the header while the socket is down. It stays quiet for 1.5 s unless the drop was found on return to the foreground. */

const meta = {
  title: 'Shell/ReconnectStatus',
  component: ReconnectStatus,
  parameters: { layout: 'padded' },
  args: { authError: null, nextRetryIn: 4, onRetry: fn() },
  decorators: [withConnectionStore({ connected: false }), (Story) => <div className="relative h-24 w-[32rem] rounded-xl border bg-background"><div className="h-10 border-b" /><Story /></div>],
} satisfies Meta<typeof ReconnectStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Countdown: Story = {};
export const RetryingNow: Story = { args: { nextRetryIn: 0 } };
export const AuthError: Story = { args: { authError: 'This device is no longer paired. Pair again to continue.' } };
