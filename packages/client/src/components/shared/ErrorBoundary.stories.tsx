import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * The last line of defense around each view. The default fallback offers a
 * reload; an error that looks like a stale PWA build also offers to reset the
 * downloaded app files.
 */

function Throws({ message }: { message: string }): never {
  throw new Error(message);
}

const meta = {
  title: 'Shared/ErrorBoundary',
  component: ErrorBoundary,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  args: { children: <div className="rounded-lg border p-4 text-sm">Children render normally.</div> },
};

export const RenderError: Story = {
  args: { children: <Throws message="Cannot read properties of undefined (reading 'id')" /> },
};

export const StaleBuildError: Story = {
  args: { children: <Throws message="Failed to fetch dynamically imported module: /assets/ChatView-abc123.js" /> },
};

export const CustomFallback: Story = {
  args: {
    children: <Throws message="boom" />,
    fallback: <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">This panel could not be shown.</div>,
  },
};
