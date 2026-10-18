import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileCodeView } from './FileCodeView';
import { createGitFileDiff, filePreviewPresets } from '../../../.storybook/mocks/mockGit';

/** Read-only code in the file preview, optionally with the working-tree diff marked. */

const diff = createGitFileDiff();

const meta: Meta<typeof FileCodeView> = {
  title: 'Files & Git/FileCodeView',
  component: FileCodeView,
  parameters: { layout: 'fullscreen' },
  args: { content: filePreviewPresets.code.content, name: 'session.ts', language: 'typescript' },
  decorators: [(Story) => <div className="h-screen overflow-auto bg-background"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithDiff: Story = {
  args: { diff: { hunks: diff.hunks, additions: diff.additions, deletions: diff.deletions } },
};

export const InferredLanguage: Story = {
  args: { language: undefined, name: 'config.json', content: '{\n  "name": "my-project",\n  "private": true\n}\n' },
};

export const PlainText: Story = {
  args: { language: undefined, name: 'notes.txt', content: 'Plain text without a known extension.\nSecond line.\n' },
};

export const LongFile: Story = {
  args: { content: Array.from({ length: 400 }, (_, i) => `const line${i} = ${i};`).join('\n') },
};
