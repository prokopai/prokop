import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import FilePreviewContent from './FilePreviewContent';
import { filePreviewPresets } from '../../../.storybook/mocks/mockGit';

/** Body of the preview overlay for every kind of preview the server can answer with. */

const meta = {
  title: 'Files & Git/FilePreviewContent',
  component: FilePreviewContent,
  parameters: { layout: 'fullscreen' },
  args: { preview: filePreviewPresets.code, onDownload: fn() },
  decorators: [(Story) => <div className="flex h-screen flex-col overflow-hidden bg-background"><Story /></div>],
} satisfies Meta<typeof FilePreviewContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Code: Story = {};
export const Text: Story = { args: { preview: filePreviewPresets.text } };
export const Markdown: Story = { args: { preview: filePreviewPresets.markdown } };
export const Image: Story = { args: { preview: filePreviewPresets.image } };
export const Binary: Story = { args: { preview: filePreviewPresets.binary } };
export const Unsupported: Story = { args: { preview: filePreviewPresets.unsupported } };
export const TooLarge: Story = { args: { preview: filePreviewPresets.tooLarge } };
export const TooLargeWithoutDownload: Story = { args: { preview: filePreviewPresets.tooLarge, onDownload: undefined } };
