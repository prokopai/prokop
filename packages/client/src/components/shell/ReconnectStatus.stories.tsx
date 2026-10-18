import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ReconnectStatus } from './ReconnectStatus';
import { ThemedToaster } from '@/components/providers/ThemedToaster';
import { useConnectionStore } from '@/stores/connectionStore';

/** The reconnect notice while the socket is down: a persistent toast with a retry action and no close button. It stays quiet for 1.5 s unless the drop was found on return to the foreground. */

const meta = {
  title: 'Shell/ReconnectStatus',
  component: ReconnectStatus,
  parameters: { layout: 'fullscreen', smoke: 'skip: sonner measures toast heights in a real browser' },
  args: { authError: null, nextRetryIn: 4, onRetry: fn() },
  decorators: [(Story) => {
    // A drop found on return to the foreground shows at once, so the story needs no 1.5 s wait.
    useConnectionStore.setState({ connected: false, foregroundRecovery: true });
    // The toaster mounts first so it is subscribed when the notice fires.
    return <div className="h-screen bg-background"><ThemedToaster /><Story /></div>;
  }],
} satisfies Meta<typeof ReconnectStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Countdown: Story = {};
export const RetryingNow: Story = { args: { nextRetryIn: 0 } };
export const AuthError: Story = { args: { authError: 'This device is no longer paired. Pair again to continue.' } };
