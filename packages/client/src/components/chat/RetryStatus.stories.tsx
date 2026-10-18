import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ChatRetryMessage } from '@prokopai/sdk';
import { RetryStatus } from './RetryStatus';
import { useChatRetryStore } from '@/stores/chatRetryStore';

/** The provider retry banner above the composer while the server retries a failed turn. */

const SESSION = 'retry-session';

function withRetry(partial: Partial<ChatRetryMessage> | null) {
  return function RetryDecorator(Story: ComponentType) {
    useChatRetryStore.setState({ retryBySessionId: {} });
    if (partial) {
      useChatRetryStore.getState().applyRetry({
        type: 'chat.retry',
        sessionId: SESSION,
        status: 'scheduled',
        retryNumber: 1,
        maxRetries: 3,
        errorType: 'rate_limit',
        message: 'Rate limited by the provider.',
        delayMs: 20_000,
        retryAt: Date.now() + 20_000,
        ...partial,
      } as ChatRetryMessage);
    }
    return <Story />;
  };
}

const meta = {
  title: 'Chat/RetryStatus',
  component: RetryStatus,
  parameters: { layout: 'padded' },
  args: { sessionId: SESSION },
  decorators: [(Story) => <div className="max-w-2xl"><Story /></div>],
} satisfies Meta<typeof RetryStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  decorators: [withRetry(null)],
};

export const Scheduled: Story = {
  decorators: [withRetry({})],
};

export const InProgress: Story = {
  decorators: [withRetry({ status: 'started', errorType: 'timeout', message: 'The provider did not answer in time.', delayMs: undefined, retryAt: undefined })],
};

export const ServerErrorLastAttempt: Story = {
  decorators: [withRetry({ errorType: 'server_error', message: 'Provider returned 503.', retryNumber: 3, maxRetries: 3, delayMs: 60_000, retryAt: Date.now() + 60_000 })],
};

export const NetworkError: Story = {
  decorators: [withRetry({ errorType: 'network', message: 'Connection reset while streaming.', retryNumber: 2 })],
};
