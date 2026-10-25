import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Workspace } from '@prokopai/sdk';
import { AddRepoControl } from '@/components/layout/AddRepoControl';

afterEach(cleanup);

const workspaces = [
  { id: 'jean2', name: 'jean2', path: '/j', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'db-web', name: 'db-web', path: '/d', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'site', name: 'site', path: '/s', createdAt: '2026-01-03T00:00:00.000Z' },
] as Workspace[];

test('lists the other workspaces, picks several, and confirms with their ids', async () => {
  const onConfirm = vi.fn();
  render(<AddRepoControl workspaces={workspaces} agents={[]} activeWorkspace={workspaces[0]!} onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open together with another workspace' }));
  const options = await screen.findAllByRole('option');
  // The switcher's order: newest first by default; the active workspace is not offered.
  expect(options.map((option) => option.textContent)).toEqual(['site', 'db-web']);
  expect(screen.getByRole('button', { name: 'Open together' })).toBeDisabled();

  fireEvent.click(screen.getByRole('option', { name: 'db-web' }));
  fireEvent.click(screen.getByRole('option', { name: 'site' }));
  expect(screen.getByText('3 workspaces in one Overview group')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'site' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open together' }));
  expect(onConfirm).toHaveBeenCalledWith(['db-web']);
});

test('renders nothing when there is no other workspace to open with', () => {
  const { container } = render(<AddRepoControl workspaces={[workspaces[0]!]} agents={[]} activeWorkspace={workspaces[0]!} onConfirm={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});
