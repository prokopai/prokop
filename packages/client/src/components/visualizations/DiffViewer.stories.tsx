import type { Meta, StoryObj } from '@storybook/react-vite';
import { DiffViewer } from './DiffViewer';
import { createDiffVisualization } from '../../../.storybook/mocks/mockVisualization';

/** One file's hunks under an edit tool row. */

const base = createDiffVisualization();

const addedOnly = createDiffVisualization({
  path: 'src/routes.ts',
  additions: 45,
  deletions: 0,
  hunks: [{
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 45,
    changes: Array.from({ length: 45 }, (_, i) => ({ type: 'added' as const, content: `router.get('/path-${i + 1}', handler${i + 1});`, newLineNumber: i + 1 })),
  }],
});

const meta: Meta<typeof DiffViewer> = {
  title: 'Visualizations/DiffViewer',
  component: DiffViewer,
  parameters: { layout: 'padded' },
  args: {
    path: base.path,
    hunks: base.hunks,
    language: base.language,
    additions: base.additions,
    deletions: base.deletions,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithPath: Story = {
  args: { showPath: true },
};

export const Folded: Story = {
  args: { path: addedOnly.path, hunks: addedOnly.hunks, additions: 45, deletions: 0, showPath: true, vizKey: 'diff-folded' },
};

export const WithMatchInfo: Story = {
  args: { showPath: true, matchInfo: { strategy: 'fuzzy', lineNumber: 12 } },
};

export const PathNotOpenable: Story = {
  args: { showPath: true, disablePathOpen: true },
};
