import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ManagedWorktree } from '@prokopai/sdk';

const baseWorktree: ManagedWorktree = {
  id: 'wt-1',
  name: 'fix-auth',
  workspaceId: 'ws-1',
  repositoryId: 'repo-1',
  path: '/data/worktrees/fix-auth',
  branch: 'fix/auth',
  head: 'abc123',
  state: 'available',
  dirty: false,
  untrackedCount: 0,
  attachments: [],
  setup: { state: 'none', ports: null, step: null, error: null, warning: null, commands: { setup: [], teardown: [] } },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let mockWorktrees: ManagedWorktree[] = [baseWorktree];
const removeMutate = vi.fn();
const approveMutate = vi.fn();
const runMutate = vi.fn();
let mockLog = '';

vi.mock('@/hooks/queries', () => ({
  useWorktreeRefsQuery: () => ({ data: [], isLoading: false }),
  useWorktreesQuery: () => ({ data: mockWorktrees, isLoading: false }),
  useWorktreeSetupLogQuery: () => ({ data: mockLog, isLoading: false }),
  useWorktreeMutations: () => ({
    create: { isPending: false, mutate: vi.fn() },
    remove: { isPending: false, mutate: removeMutate },
    bind: { isPending: false, mutate: vi.fn() },
    unbind: { isPending: false, mutate: vi.fn() },
    approveSetup: { isPending: false, mutate: approveMutate },
    runSetup: { isPending: false, mutate: runMutate },
  }),
}));

const commands = { setup: ['bun install', 'bun run db:create'], teardown: ['bun run db:drop'] };

import { WorktreesPanel } from '@/components/worktrees/WorktreesPanel';

describe('WorktreesPanel', () => {
  beforeEach(() => {
    mockWorktrees = [baseWorktree];
    mockLog = '';
    removeMutate.mockClear();
    approveMutate.mockClear();
    runMutate.mockClear();
  });

  test('setup waiting for approval shows the commands and one Run setup action', async () => {
    const user = userEvent.setup();
    mockWorktrees = [{
      ...baseWorktree,
      setup: { state: 'needs_approval', ports: { base: 20010, count: 10 }, step: null, error: null, warning: null, commands },
    }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText('bun install · bun run db:create')).toBeInTheDocument();
    const run = screen.getByRole('button', { name: 'Run setup' });
    expect(run).toHaveAttribute('title', expect.stringContaining('(teardown) bun run db:drop'));
    await user.click(run);

    expect(approveMutate).toHaveBeenCalledWith('wt-1', expect.anything());
    expect(runMutate).not.toHaveBeenCalled();
  });

  test('a running setup shows its step and offers no action', () => {
    mockWorktrees = [{
      ...baseWorktree,
      setup: { state: 'running', ports: null, step: 'setup 1/2: bun install', error: null, warning: null, commands },
    }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText('setup 1/2: bun install')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  test('a failed setup shows the first error line, retries, and opens the log', async () => {
    const user = userEvent.setup();
    mockLog = '$ bun run db:create\nerror: database exists\n\n# exit code 1\n';
    mockWorktrees = [{
      ...baseWorktree,
      setup: {
        state: 'failed',
        ports: { base: 20010, count: 10 },
        step: 'setup 2/2: bun run db:create',
        error: 'exit code 1\nerror: database exists',
        warning: null,
        commands,
      },
    }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText('setup 2/2: bun run db:create: exit code 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(runMutate).toHaveBeenCalledWith('wt-1', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Log' }));
    expect(screen.getByRole('dialog', { name: 'Setup log' })).toBeInTheDocument();
    expect(screen.getByText(/error: database exists/)).toBeInTheDocument();
  });

  test('a ready setup shows its port and a note; the menu offers the log and a re-run', async () => {
    const user = userEvent.setup();
    mockWorktrees = [{
      ...baseWorktree,
      setup: {
        state: 'ready',
        ports: { base: 20010, count: 10 },
        step: null,
        error: null,
        warning: 'skipped clone node_modules: not in the primary checkout',
        commands,
      },
    }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText(':20010')).toBeInTheDocument();
    expect(screen.getByText('skipped clone node_modules: not in the primary checkout')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    expect(screen.getByRole('menuitem', { name: /Setup log/ })).toBeEnabled();
    await user.click(screen.getByRole('menuitem', { name: /Run setup again/ }));
    expect(runMutate).toHaveBeenCalledWith('wt-1', expect.anything());
  });

  test('a worktree without a setup file shows no setup line or menu items', async () => {
    const user = userEvent.setup();
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    expect(screen.queryByRole('menuitem', { name: /Setup log/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run setup' })).not.toBeInTheDocument();
  });

  test('lists worktrees with branch and state', () => {
    mockWorktrees = [
      baseWorktree,
      { ...baseWorktree, id: 'wt-2', name: 'gone', branch: null, state: 'missing' },
    ];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText('fix-auth')).toBeInTheDocument();
    expect(screen.getByText('(fix/auth)')).toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();
    expect(screen.getByText('Directory is missing')).toBeInTheDocument();
  });

  test('shows the inline create form from the + button', async () => {
    const user = userEvent.setup();
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    await user.click(screen.getByRole('button', { name: 'New worktree' }));

    expect(screen.getByPlaceholderText('Search branches…')).toBeInTheDocument();
    expect(screen.getByLabelText('Worktree name')).toBeInTheDocument();
  });

  test('remove is blocked with the reason inline', async () => {
    const user = userEvent.setup();
    mockWorktrees = [{
      ...baseWorktree,
      dirty: true,
      attachments: [{ sessionId: 's1', title: 'Auth work', running: true }],
    }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText(/Has uncommitted changes/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    expect(screen.getByRole('menuitem', { name: /Remove/ })).toHaveAttribute('aria-disabled', 'true');
  });

  test('idle attached sessions do not block removal and render as info', async () => {
    const user = userEvent.setup();
    mockWorktrees = [{
      ...baseWorktree,
      attachments: [{ sessionId: 's1', title: 'Auth work', running: false }],
    }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText('1 session attached')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    const removeItem = screen.getByRole('menuitem', { name: /Remove/ });
    expect(removeItem).toBeEnabled();
    await user.click(removeItem);

    expect(removeMutate).toHaveBeenCalledWith('wt-1', expect.anything());
  });

  test('remove fires immediately for a clean worktree', async () => {
    const user = userEvent.setup();
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    await user.click(screen.getByRole('menuitem', { name: /Remove/ }));

    expect(removeMutate).toHaveBeenCalledWith('wt-1', expect.anything());
  });

  test('removed records offer purge and stay listed', async () => {
    const user = userEvent.setup();
    mockWorktrees = [{ ...baseWorktree, state: 'removed' }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    expect(screen.getByRole('menuitem', { name: /Purge record/ })).toBeEnabled();

    await user.click(screen.getByRole('menuitem', { name: /Purge record/ }));
    expect(removeMutate).toHaveBeenCalledWith('wt-1', expect.anything());
  });

  test('shows the empty state when there are no worktrees', () => {
    mockWorktrees = [];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText(/No worktrees yet/)).toBeInTheDocument();
  });
});
