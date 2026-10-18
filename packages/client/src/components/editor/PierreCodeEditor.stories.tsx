import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PierreCodeEditor, type PierreEditorGitDiff } from './PierreCodeEditor';
import { createEditableFile, createGitFileDiff } from '../../../.storybook/mocks/mockGit';

/** The editable code surface, with optional working-tree diff gutters. */

const diff = createGitFileDiff();
const gitDiff: PierreEditorGitDiff = { hunks: diff.hunks, additions: diff.additions, deletions: diff.deletions } as PierreEditorGitDiff;

interface Args {
  fileName: string;
  value: string;
  gitDiff: PierreEditorGitDiff | null;
  showGitDiff: boolean;
  saving: boolean;
  selectedLines?: { start: number; end: number };
  onChange: (value: string) => void;
}

function Harness({ value, onChange, ...rest }: Args) {
  const [text, setText] = useState(value);
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <PierreCodeEditor docId={`story:${rest.fileName}`} value={text} onChange={(next) => { setText(next); onChange(next); }} className="min-h-0 flex-1" {...rest} />
    </div>
  );
}

const meta = {
  title: 'Files & Git/PierreCodeEditor',
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: Pierre editor is a custom element; happy-dom has no layout',
  },
  args: { fileName: 'session.ts', value: createEditableFile().content, gitDiff: null, showGitDiff: true, saving: false, onChange: fn() },
  render: (args) => <Harness {...args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Default: Story = {};

export const WithGitDiff: Story = {
  args: { gitDiff },
};

export const GitDiffHidden: Story = {
  args: { gitDiff, showGitDiff: false },
};

export const Saving: Story = {
  args: { saving: true },
};

export const SelectedLines: Story = {
  args: { selectedLines: { start: 9, end: 12 } },
};

export const Markdown: Story = {
  args: { fileName: 'README.md', value: '# Title\n\nSome **bold** text.\n\n- one\n- two\n' },
};

export const Empty: Story = {
  args: { fileName: 'new.ts', value: '' },
};
