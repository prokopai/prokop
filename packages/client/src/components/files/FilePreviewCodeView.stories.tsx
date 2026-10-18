import type { Meta, StoryObj } from '@storybook/react-vite';
import FilePreviewCodeView from './FilePreviewCodeView';
import { filePreviewPresets } from '../../../.storybook/mocks/mockGit';

/** Highlighted source for the preview overlay, with or without line numbers. */

const meta = {
  title: 'Files & Git/FilePreviewCodeView',
  component: FilePreviewCodeView,
  parameters: { layout: 'padded' },
  args: { content: filePreviewPresets.code.content, path: 'src/auth/session.ts', language: 'typescript', showLineNumbers: true },
} satisfies Meta<typeof FilePreviewCodeView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoLineNumbers: Story = {
  args: { showLineNumbers: false },
};

export const Css: Story = {
  args: { path: 'src/index.css', language: 'css', content: ':root {\n  --radius: 0.5rem;\n}\n\n.dark {\n  --background: oklch(0.165 0.014 265);\n}\n' },
};

export const Empty: Story = {
  args: { content: '' },
};
