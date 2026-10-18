import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommitFileDiff } from './CommitPatch';
import { commitFiles, parseCommitPatch } from './commitFiles';
import { samplePatch } from '../../../.storybook/mocks/mockGit';

/** One file of a commit's patch, as the Branches view shows it. */

const parsed = parseCommitPatch(samplePatch);
const files = commitFiles(['src/auth/session.ts', 'src/auth/session.test.ts', 'assets/logo.png'], parsed.files);

const meta = {
  title: 'Files & Git/CommitPatch',
  component: CommitFileDiff,
  parameters: { layout: 'padded' },
  args: { file: files[0]!, themeType: 'dark' },
} satisfies Meta<typeof CommitFileDiff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ModifiedFile: Story = {};

export const AddedFile: Story = {
  args: { file: files[1]! },
};

export const NoTextDiff: Story = {
  args: { file: files[2]! },
};

export const LightTheme: Story = {
  args: { themeType: 'light' },
  globals: { themeMode: 'light' },
};
