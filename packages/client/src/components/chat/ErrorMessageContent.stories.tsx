import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorMessageContent } from './ErrorMessageContent';
import { createAssistantMessage } from '../../../.storybook/mocks/mockMessage';

/** A failed assistant turn, classified from the provider's error text. */

function failed(error: string) {
  return createAssistantMessage({ status: 'error', error }) as Parameters<typeof ErrorMessageContent>[0]['message'];
}

const meta = {
  title: 'Chat/ErrorMessageContent',
  component: ErrorMessageContent,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="max-w-2xl"><Story /></div>],
} satisfies Meta<typeof ErrorMessageContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RateLimited: Story = {
  args: { message: failed('429 Too Many Requests: rate limit exceeded, retry after 20s') },
};

export const ServerError: Story = {
  args: { message: failed('Provider returned 502 Bad Gateway') },
};

export const ContextTooLong: Story = {
  args: { message: failed('This model\'s maximum context length is 200000 tokens. However, your messages resulted in 214231 tokens.') },
};

export const Authentication: Story = {
  args: { message: failed('401 Unauthorized: invalid x-api-key') },
};

export const NetworkError: Story = {
  args: { message: failed('fetch failed: ECONNRESET') },
};

export const Unknown: Story = {
  args: { message: failed('Something went sideways in a way nobody anticipated.') },
};

export const NoDetail: Story = {
  args: { message: createAssistantMessage({ status: 'error' }) as Parameters<typeof ErrorMessageContent>[0]['message'] },
};
