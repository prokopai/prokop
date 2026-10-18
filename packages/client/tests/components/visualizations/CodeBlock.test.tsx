import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CodeBlock } from '@/components/visualizations/CodeBlock';

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
// mock surfaces file contents and the selection range as attributes so the
// truncation and highlight mapping stay assertable.
vi.mock('@pierre/diffs/react', () => ({
  File: ({
    file,
    selectedLines,
  }: {
    file: { contents: string };
    selectedLines: { start: number; end: number } | null;
  }) => (
    <div
      data-testid="pierre-file"
      data-selected={selectedLines ? `${selectedLines.start}-${selectedLines.end}` : 'none'}
    >
      {file.contents}
    </div>
  ),
}));

function makeContent(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');
}

const showAll = (lines: number) => screen.getByRole('button', { name: `Show all ${lines} lines` });

describe('CodeBlock', () => {
  it('renders code content via text match', () => {
    render(<CodeBlock content="console.log" path="src/render.ts" />);
    expect(screen.getByTestId('pierre-file').textContent).toContain('console.log');
  });

  it('has no header: the path shows only when asked for', () => {
    const { unmount } = render(<CodeBlock content="hello" path="src/main.ts" />);
    expect(screen.queryByText('src/main.ts')).not.toBeInTheDocument();
    unmount();
    render(<CodeBlock content="hello" path="src/main.ts" showPath />);
    expect(screen.getByText('src/main.ts')).toBeInTheDocument();
  });

  it('carries no created or overwrote badge', () => {
    render(<CodeBlock content="hello" path="src/created.ts" />);
    expect(screen.queryByText(/Created|Overwrote/)).not.toBeInTheDocument();
  });

  it('peeks at the first lines by default and offers Show all', () => {
    render(<CodeBlock content={makeContent(30)} path="src/peek.ts" />);
    const fileEl = screen.getByTestId('pierre-file');
    expect(fileEl.textContent).toContain('line 20');
    expect(fileEl.textContent).not.toContain('line 21');
    expect(showAll(30)).toBeInTheDocument();
  });

  it('shows the whole file inline after Show all, with no nested scroller', async () => {
    const { container } = render(<CodeBlock content={makeContent(30)} path="src/full.ts" />);
    await userEvent.click(showAll(30));
    expect(screen.getByTestId('pierre-file').textContent).toContain('line 30');
    expect(container.querySelector('.tool-output-scroll')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByTestId('pierre-file').textContent).not.toContain('line 21');
  });

  it('offers no Show all for a file within the budget', () => {
    render(<CodeBlock content={makeContent(10)} path="src/short.ts" />);
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('opens the file preview from the Open file action', async () => {
    render(<CodeBlock content="hello" path="src/title.ts" />);
    const open = screen.getByRole('button', { name: 'Open file' });
    expect(open).toHaveAttribute('title', 'src/title.ts');
    await userEvent.click(open);
    expect(openFilePreview).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', name: 'title.ts' }));
  });

  it('keeps expansion state across remounts (virtualizer recycling)', async () => {
    const content = makeContent(30);
    const path = 'src/persist.ts';
    const { unmount } = render(<CodeBlock content={content} path={path} />);
    await userEvent.click(showAll(30));
    unmount();

    // Remount (fresh component instance): the expanded choice must hold.
    render(<CodeBlock content={content} path={path} />);
    expect(screen.getByTestId('pierre-file').textContent).toContain('line 30');
  });

  it('scopes expansion state by vizKey, not path+length', async () => {
    const content = makeContent(30);
    const path = 'src/shared.ts';

    // Tool call A (vizKey a): user expands it.
    const { unmount } = render(<CodeBlock content={content} path={path} vizKey="part-a" />);
    await userEvent.click(showAll(30));
    expect(screen.getByTestId('pierre-file').textContent).toContain('line 30');
    unmount();

    // Tool call B: same path, same content, different part id: still a peek.
    render(<CodeBlock content={content} path={path} vizKey="part-b" />);
    expect(screen.getByTestId('pierre-file').textContent).not.toContain('line 21');
  });

  it('maps highlightLines onto the selection range', () => {
    render(
      <CodeBlock content={'line1\nline2\nline3'} path="src/highlight.ts" highlightLines={[2]} />,
    );
    expect(screen.getByTestId('pierre-file')).toHaveAttribute('data-selected', '2-2');
  });

  it('clamps the selection to the folded peek length', () => {
    render(<CodeBlock content={makeContent(30)} path="src/clamp.ts" highlightLines={[25]} />);
    expect(screen.getByTestId('pierre-file')).toHaveAttribute('data-selected', '20-20');
  });

  it('passes no selection when highlightLines is empty', () => {
    render(<CodeBlock content="hello" path="src/noselect.ts" />);
    expect(screen.getByTestId('pierre-file')).toHaveAttribute('data-selected', 'none');
  });
});
