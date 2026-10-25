import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { FileActionsDialogs } from '@/components/files/FileActionsDialogs';

afterEach(cleanup);

const target = { path: 'src/auth/session.ts', isDirectory: false, name: 'session.ts' };

function setup(folders: Array<{ path: string }> = []) {
  const submitMove = vi.fn();
  const get = vi.fn().mockResolvedValue({ files: folders.map((folder) => ({ ...folder, name: folder.path.split('/').pop(), type: 'directory' })).concat([{ path: 'lib/index.ts', name: 'index.ts', type: 'file' }]) });
  const client = { httpClient: { get } } as unknown as ProkopaiClient;
  render(<FileActionsDialogs
    dialog={{ type: 'move', target }} mutating={false} error={null} overwrite={false} renameConflict={false}
    onClose={vi.fn()} submitCreate={vi.fn()} submitRename={vi.fn()} submitDelete={vi.fn()} setOverwrite={vi.fn()}
    submitMove={submitMove} sdkClient={client} workspaceId="ws"
  />);
  return { submitMove, get, input: screen.getByLabelText('Destination folder') as HTMLInputElement };
}

test('the move dialog starts at the current folder and moves to what is typed; empty means the root', () => {
  const { submitMove, input } = setup();
  expect(input.value).toBe('src/auth');
  fireEvent.change(input, { target: { value: 'lib' } });
  fireEvent.submit(input.closest('form')!);
  expect(submitMove).toHaveBeenCalledWith('lib');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.submit(input.closest('form')!);
  expect(submitMove).toHaveBeenLastCalledWith('');
});

test('typing lists matching folders only; arrows walk them and Enter takes the walked-to one, then Enter moves', async () => {
  const { submitMove, get, input } = setup([{ path: 'lib' }, { path: 'src/lib' }]);
  fireEvent.change(input, { target: { value: 'li' } });
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.getAttribute('title'))).toEqual(['lib/', 'src/lib/']);
  await waitFor(() => expect(get).toHaveBeenCalledWith('/workspaces/ws/files', expect.objectContaining({ params: expect.objectContaining({ search: 'li' }) })));

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input.value).toBe('src/lib');
  expect(submitMove).not.toHaveBeenCalled();

  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(submitMove).toHaveBeenCalledWith('src/lib'));
});
