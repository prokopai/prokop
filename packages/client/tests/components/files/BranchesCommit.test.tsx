import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FileDiffMetadata } from '@pierre/diffs';
import type { ProkopaiClient } from '@prokopai/sdk';
import { gitStatusFeedStub } from '../../helpers';
import { BranchesPanel } from '@/components/files/BranchesPanel';

// Pierre renders into shadow DOM; the mock exposes which file is mounted.
vi.mock('@pierre/diffs/react', () => ({
  FileDiff: ({ fileDiff }: { fileDiff: FileDiffMetadata }) => <div data-testid="file-diff" data-name={fileDiff.name} />,
}));

const head = 'a'.repeat(40);
const commitHead = 'b'.repeat(40);
const action = vi.fn();
const branches = vi.fn();
const gitHistory = vi.fn();
const gitCommitDetails = vi.fn();
const client = { ...gitStatusFeedStub, http: { files: { gitRebaseState: vi.fn(async () => ({ active: false, conflicts: [], token: null })), gitBranches: branches, gitBranchAction: action, gitHistory, gitCommitDetails } } } as unknown as ProkopaiClient;

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  ' one',
  '-two',
  '+TWO',
  'diff --git a/docs/b.md b/docs/b.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/docs/b.md',
  '@@ -0,0 +1,2 @@',
  '+hello',
  '+world',
  '',
].join('\n');

beforeEach(() => {
  action.mockReset().mockResolvedValue({});
  branches.mockReset().mockResolvedValue({ repository: { branch: 'main', head, remotes: ['origin'], upstream: { remote: 'origin', branch: 'main' } }, branches: [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true, checkedOut: true, upstream: 'refs/remotes/origin/main', ahead: 0, behind: 0, committedAt: null }], lastFetchedAt: null });
  gitHistory.mockReset().mockResolvedValue({ commits: [{ head: commitHead, subject: 'Rename things', author: 'Test', date: '2026-01-02T00:00:00Z', parents: [head] }], nextOffset: null });
  gitCommitDetails.mockReset().mockResolvedValue({ files: ['src/a.ts', 'docs/b.md', 'logo.png'], patch });
});

function renderPanel() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BranchesPanel sdkClient={client} workspaceId="ws" serverId="server" root="/tree" /></QueryClientProvider>);
}

test('opening a commit hides the branch toolbar and shows one file at a time', async () => {
  renderPanel();
  fireEvent.click(await screen.findByText('Rename things'));
  expect(gitCommitDetails).toHaveBeenCalledWith('ws', { root: '/tree', head: commitHead });
  const list = await screen.findByRole('list', { name: 'Changed files' });
  expect(screen.queryByRole('button', { name: 'Select branch history' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pull' })).not.toBeInTheDocument();
  expect(screen.getByText('main')).toBeInTheDocument();
  expect(screen.getByText('3 changed files')).toBeInTheDocument();
  expect(list.querySelectorAll('li')).toHaveLength(3);
  expect(screen.getByTitle('src/a.ts (modified)')).toHaveAttribute('aria-current', 'true');
  expect(screen.getByTitle('docs/b.md (added)')).toBeInTheDocument();
  expect(screen.getByTitle('logo.png (modified)')).toBeInTheDocument();
  expect(screen.getByText('binary')).toBeInTheDocument();
  expect(screen.getAllByTestId('file-diff')).toHaveLength(1);
  expect(screen.getByTestId('file-diff')).toHaveAttribute('data-name', 'src/a.ts');

  fireEvent.click(screen.getByTitle('docs/b.md (added)'));
  expect(screen.getByTestId('file-diff')).toHaveAttribute('data-name', 'docs/b.md');
  expect(screen.getByText('2/3')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
  expect(screen.queryByTestId('file-diff')).not.toBeInTheDocument();
  expect(screen.getByText('No text diff for this file.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next file' })).toBeDisabled();

  fireEvent.keyDown(list, { key: 'k' });
  expect(screen.getByTestId('file-diff')).toHaveAttribute('data-name', 'docs/b.md');
  fireEvent.keyDown(list, { key: 'ArrowUp' });
  expect(screen.getByTestId('file-diff')).toHaveAttribute('data-name', 'src/a.ts');
  expect(screen.getByRole('button', { name: 'Previous file' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'History' }));
  expect(await screen.findByRole('button', { name: 'Select branch history' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pull' })).toBeInTheDocument();
});

test('new branch from the commit header starts at the commit', async () => {
  renderPanel();
  fireEvent.click(await screen.findByText('Rename things'));
  fireEvent.click(await screen.findByRole('button', { name: 'New branch from this commit' }));
  fireEvent.change(screen.getByLabelText('New branch name'), { target: { value: 'from-commit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith('ws', { action: 'create', name: 'from-commit', startHead: commitHead, root: '/tree' }));
});
