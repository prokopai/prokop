import type { Meta, StoryObj } from '@storybook/react-vite';
import ImagePreview from './ImagePreview';
import { filePreviewPresets } from '../../../.storybook/mocks/mockGit';

/**
 * Images on a checkerboard. Small images (icons) scale up in whole steps and
 * stay pixelated; click toggles actual size.
 */

const bigSvg = (w: number, h: number) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0.3"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="48" text-anchor="middle" dominant-baseline="middle">${w} × ${h}</text></svg>`,
)}`;

const meta = {
  title: 'Files & Git/ImagePreview',
  component: ImagePreview,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="flex h-screen flex-col overflow-hidden bg-background"><Story /></div>],
} satisfies Meta<typeof ImagePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SmallIcon: Story = {
  args: { src: filePreviewPresets.image.dataUrl, name: 'logo.svg' },
};

export const LargeImage: Story = {
  args: { src: bigSvg(2400, 1600), name: 'screenshot.png' },
};

export const TallImage: Story = {
  args: { src: bigSvg(600, 3000), name: 'long-page.png' },
};

export const Broken: Story = {
  args: { src: '/api/missing.png', name: 'missing.png' },
};
