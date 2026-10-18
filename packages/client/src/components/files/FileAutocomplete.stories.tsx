import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { FileEntry } from '@prokopai/sdk';
import { FileAutocomplete } from './FileAutocomplete';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createFileEntry } from '../../../.storybook/mocks/mockFileTree';

/**
 * The `@` file picker above the composer. An empty query lists files with Git
 * changes; typing searches the workspace. Arrow keys move the highlight.
 */

const changed: FileEntry[] = [
  createFileEntry({ name: 'session.ts', path: 'src/auth/session.ts', git: { status: 'modified', staged: false, unstaged: true } }),
  createFileEntry({ name: 'refresh.ts', path: 'src/auth/refresh.ts', git: { status: 'modified', staged: false, unstaged: true } }),
  createFileEntry({ name: 'newHelper.ts', path: 'src/lib/newHelper.ts', git: { status: 'untracked', staged: false, unstaged: true } }),
  createFileEntry({ name: 'components', type: 'directory', path: 'src/components', extension: undefined }),
];

const many: FileEntry[] = Array.from({ length: 40 }, (_, i) => createFileEntry({ name: `file-${i}.ts`, path: `src/module-${i % 5}/file-${i}.ts` }));

function clientWith(files: FileEntry[], latencyMs = 0) {
  return createFakeSdkClient({ latencyMs, rawGet: async () => ({ files }) });
}

function Harness(args: Omit<React.ComponentProps<typeof FileAutocomplete>, 'selectedIndex' | 'onSelectedIndexChange'>) {
  const [index, setIndex] = useState(0);
  return (
    <div className="w-[36rem] rounded-xl border bg-card p-2">
      <FileAutocomplete {...args} selectedIndex={index} onSelectedIndexChange={setIndex} />
    </div>
  );
}

const meta: Meta<typeof FileAutocomplete> = {
  title: 'Files & Git/FileAutocomplete',
  component: FileAutocomplete,
  parameters: { layout: 'centered' },
  args: {
    workspaceId: 'ws-1',
    searchQuery: '',
    selectedIndex: 0,
    onSelectedIndexChange: fn(),
    onSelect: fn(),
    onFilesChange: fn(),
    sdkClient: clientWith(changed),
  },
  render: (args) => <Harness {...args} />,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ChangedFiles: Story = {};

export const SearchResults: Story = {
  args: { searchQuery: 'auth', sdkClient: clientWith(changed.filter((file) => file.path.includes('auth'))) },
};

export const ManyResults: Story = {
  args: { searchQuery: 'file', sdkClient: clientWith(many) },
};

export const NoMatches: Story = {
  args: { searchQuery: 'zzz', sdkClient: clientWith([]) },
};

export const Loading: Story = {
  args: { searchQuery: 'ses', sdkClient: clientWith(changed, 60_000) },
};

export const Failed: Story = {
  args: { searchQuery: 'ses', sdkClient: createFakeSdkClient({ rawGet: async () => { throw new Error('Workspace unavailable'); } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
