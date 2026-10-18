import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import FilePreviewOverlay from './FilePreviewOverlay';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createGitFileDiff, filePreviewPresets } from '../../../.storybook/mocks/mockGit';

/**
 * The read-only file preview opened from the tree, chat links and Changes.
 * The fake server answers every preset path; other paths are not found.
 */

function target(path: string, extra: Partial<{ root: string; anywhere: boolean }> = {}) {
  return { workspaceId: 'ws-1', path, name: path.split('/').pop() ?? path, ...extra };
}

const meta = {
  title: 'Files & Git/FilePreviewOverlay',
  component: FilePreviewOverlay,
  parameters: { layout: 'fullscreen' },
  args: {
    workspaceId: 'ws-1',
    target: target(filePreviewPresets.code.path),
    sdkClient: createFakeSdkClient(),
    open: true,
    onOpenChange: fn(),
    onOpenEdit: fn(),
  },
} satisfies Meta<typeof FilePreviewOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Code: Story = {};

export const CodeWithDiff: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { gitDiff: async () => createGitFileDiff() } } }) },
};

export const Markdown: Story = {
  args: { target: target(filePreviewPresets.markdown.path) },
};

export const Image: Story = {
  args: { target: target(filePreviewPresets.image.path) },
};

export const Binary: Story = {
  args: { target: target(filePreviewPresets.binary.path) },
};

export const TooLarge: Story = {
  args: { target: target(filePreviewPresets.tooLarge.path) },
};

export const NotFound: Story = {
  args: { target: target('src/missing.ts') },
};

export const DeletedInWorkingTree: Story = {
  args: {
    target: target('src/lib/oldHelper.ts'),
    sdkClient: createFakeSdkClient({
      http: {
        files: {
          gitDiff: async () => createGitFileDiff({
            path: 'src/lib/oldHelper.ts',
            status: { status: 'deleted', staged: false, unstaged: true },
            additions: 0,
            deletions: 31,
            hunks: [{ oldStart: 1, oldLines: 3, newStart: 0, newLines: 0, changes: [
              { type: 'removed', content: 'export function oldHelper() {', lineNumber: 1 },
              { type: 'removed', content: '  return 1;', lineNumber: 2 },
              { type: 'removed', content: '}', lineNumber: 3 },
            ] }],
          }),
        },
      },
    }),
  },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const NoEditAction: Story = {
  args: { onOpenEdit: undefined },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
