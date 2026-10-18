import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { FileDiffMetadata } from '@pierre/diffs';
import { DiffViewer } from '@/components/visualizations/DiffViewer';

const openFilePreview = vi.fn();

vi.mock('@/stores/uiStore', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openFilePreview }),
  ),
}));

vi.mock('@/stores/serverDataStore', async (importOriginal) => ({
  selectActiveWorkspace: (await importOriginal<typeof import('@/stores/serverDataStore')>()).selectActiveWorkspace,
  useServerDataStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaces: [{ id: 'ws-1', name: 'test', path: '/repo' }], activeWorkspaceId: 'ws-1' }),
  ),
}));

// Pierre renders into shadow DOM, invisible to light-DOM text queries; the
// mock surfaces the parsed diff (real parsePatchFiles) so content assertions
// stay behavioral.
vi.mock('@pierre/diffs/react', () => ({
  FileDiff: ({ fileDiff }: { fileDiff: FileDiffMetadata }) => (
    <div data-testid="patch-diff" data-name={fileDiff.name} data-cache-key={fileDiff.cacheKey}>
      {fileDiff.hunks.map((hunk) => hunk.hunkSpecs).join('\n')}
      {'\n'}
      {fileDiff.deletionLines.map((line) => `-${line}`).join('')}
      {fileDiff.additionLines.map((line) => `+${line}`).join('')}
    </div>
  ),
  PatchDiff: ({ patch }: { patch: string }) => (
    <div data-testid="patch-diff-fallback">{patch}</div>
  ),
}));

const sampleHunks = [
  {
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 3,
    changes: [
      { type: 'context' as const, content: 'unchanged line', lineNumber: 1, newLineNumber: 1 },
      { type: 'removed' as const, content: 'old line', lineNumber: 2 },
      { type: 'added' as const, content: 'new line', newLineNumber: 2 },
    ],
  },
];

function addedHunk(lines: number) {
  return {
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: lines,
    changes: Array.from({ length: lines }, (_, i) => ({ type: 'added' as const, content: `added ${i + 1}`, newLineNumber: i + 1 })),
  };
}

describe('DiffViewer', () => {
  it('names the file only when asked to (several files under one row)', () => {
    const { unmount } = render(<DiffViewer hunks={sampleHunks} path="src/app-header.tsx" />);
    expect(screen.queryByText('src/app-header.tsx')).not.toBeInTheDocument();
    unmount();
    render(<DiffViewer hunks={sampleHunks} path="src/app-header.tsx" showPath />);
    expect(screen.getByText('src/app-header.tsx')).toBeInTheDocument();
  });

  it('serializes hunks into the rendered patch', () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-serialize.tsx" />);
    const patchEl = screen.getByTestId('patch-diff');
    // hunksToPatch emits plain ---/+++ headers, so Pierre keeps the b/ prefix.
    expect(patchEl.getAttribute('data-name')).toBe('b/src/app-serialize.tsx');
    expect(patchEl.textContent).toContain('@@ -1,3 +1,3 @@');
    expect(patchEl.textContent).toContain('-old line');
    expect(patchEl.textContent).toContain('+new line');
    expect(patchEl.textContent).toContain('unchanged line');
  });

  it('keys the diff by content so remounts reuse the worker highlight cache', () => {
    const { unmount } = render(<DiffViewer hunks={sampleHunks} path="src/app-key.tsx" />);
    const firstKey = screen.getByTestId('patch-diff').getAttribute('data-cache-key');
    unmount();
    render(<DiffViewer hunks={sampleHunks} path="src/app-key.tsx" />);
    expect(screen.getByTestId('patch-diff').getAttribute('data-cache-key')).toBe(firstKey);
    expect(firstKey).toBeTruthy();
  });

  it('changes the cache key when the diff content changes', () => {
    const { unmount } = render(<DiffViewer hunks={sampleHunks} path="src/app-rekey.tsx" />);
    const firstKey = screen.getByTestId('patch-diff').getAttribute('data-cache-key');
    unmount();
    const edited = [{
      ...sampleHunks[0],
      changes: [
        ...sampleHunks[0].changes.slice(0, 2),
        { type: 'added' as const, content: 'other line', newLineNumber: 2 },
      ],
    }];
    render(<DiffViewer hunks={edited} path="src/app-rekey.tsx" />);
    expect(screen.getByTestId('patch-diff').getAttribute('data-cache-key')).not.toBe(firstKey);
  });

  it('shows additions and deletions beside the named file', () => {
    render(
      <DiffViewer hunks={sampleHunks} path="src/app-counts.tsx" additions={5} deletions={3} showPath />,
    );
    expect(screen.getByText('+5 -3')).toBeInTheDocument();
  });

  it('hides additions/deletions when not provided', () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-nocounts.tsx" showPath />);
    expect(screen.queryByText(/^\+\d+ -\d+$/)).not.toBeInTheDocument();
  });

  it('peeks at the first diff lines and grows inline on Show all', async () => {
    const { container } = render(<DiffViewer hunks={[addedHunk(45)]} path="src/app-long.tsx" vizKey="long" />);
    let patchEl = screen.getByTestId('patch-diff');
    expect(patchEl.textContent).toContain('+added 30');
    expect(patchEl.textContent).not.toContain('+added 31');

    await userEvent.click(screen.getByRole('button', { name: 'Show all 45 lines' }));
    patchEl = screen.getByTestId('patch-diff');
    expect(patchEl.textContent).toContain('+added 45');
    expect(container.querySelector('.tool-output-scroll')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByTestId('patch-diff').textContent).not.toContain('+added 31');
  });

  it('offers no Show all for a diff within the budget', () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-short.tsx" />);
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('renders multiple hunks', () => {
    const multiHunks = [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        changes: [
          { type: 'added' as const, content: 'hunk1 line', newLineNumber: 1 },
        ],
      },
      {
        oldStart: 10,
        oldLines: 1,
        newStart: 10,
        newLines: 1,
        changes: [
          { type: 'added' as const, content: 'hunk2 line', newLineNumber: 10 },
        ],
      },
    ];
    render(<DiffViewer hunks={multiHunks} path="src/app-multihunk.tsx" />);
    const patchEl = screen.getByTestId('patch-diff');
    expect(patchEl.textContent).toContain('+hunk1 line');
    expect(patchEl.textContent).toContain('+hunk2 line');
  });

  it('opens the file from the Open file action unless opening is disabled', async () => {
    const { unmount } = render(<DiffViewer hunks={sampleHunks} path="src/app-title.tsx" />);
    const open = screen.getByRole('button', { name: 'Open file' });
    expect(open).toHaveAttribute('title', 'src/app-title.tsx');
    await userEvent.click(open);
    expect(openFilePreview).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', name: 'app-title.tsx' }));
    unmount();

    render(<DiffViewer hunks={sampleHunks} path="src/app-locked.tsx" disablePathOpen />);
    expect(screen.queryByRole('button', { name: 'Open file' })).not.toBeInTheDocument();
  });
});
