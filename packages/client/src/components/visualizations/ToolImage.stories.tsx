import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToolImage } from './ToolImage';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

/** An image a tool produced. With no server URL the attachment path is used as is. */

const svg = (label: string, w: number, h: number) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#6b7280"/><text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="24" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`,
)}`;

function withoutServerUrl(Story: ComponentType) {
  return (
    <ServerClientProvider value={{ sdkClient: null, serverUrl: null, apiToken: null, connected: false }}>
      <Story />
    </ServerClientProvider>
  );
}

const meta = {
  title: 'Visualizations/ToolImage',
  component: ToolImage,
  parameters: { layout: 'padded' },
  decorators: [withoutServerUrl],
} satisfies Meta<typeof ToolImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { url: svg('640 x 400', 640, 400), alt: 'Generated chart' },
};

export const Tall: Story = {
  args: { url: svg('400 x 1200', 400, 1200), alt: 'Tall screenshot' },
};

export const Wide: Story = {
  args: { url: svg('1800 x 300', 1800, 300), alt: 'Wide banner' },
};

export const Missing: Story = {
  args: { url: '/api/sessions/x/attachments/missing', alt: 'Image that failed to load' },
};
