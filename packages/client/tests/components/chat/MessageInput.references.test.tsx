import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { FileEntry, ProkopaiClient, Session } from '@prokopai/sdk';
import { MessageInput } from '@/components/chat/MessageInput';
import { clearDraft, loadDraft } from '@/config/draftStorage';
import { insertIntoComposer } from '@/lib/composerTargets';
import { composerText, getComposer, pressInComposer, typeInComposer } from '../../composerHelpers';

vi.mock('@/components/worktrees/SessionCheckoutSelector', () => ({
  SessionCheckoutSelector: () => null,
  SessionCheckoutStrip: () => null,
}));
vi.mock('@/components/chat/AutoApproveSelector', () => ({ AutoApproveSelector: () => null }));
vi.mock('@/hooks/queries', () => ({ useResponseFormatsQuery: () => ({ data: { formats: [] } }) }));

const session = {
  id: 'references-test',
  workspaceId: 'ws',
  harness: 'prokop',
  status: 'active',
  workspaceRootId: 'wt-1',
  worktree: { id: 'wt-1', name: 'feature', branch: 'feature', path: '/repo/.worktrees/feature', state: 'available' },
} as unknown as Session;

afterEach(() => {
  clearDraft(session.id);
  clearDraft('closed-session');
});

const files: FileEntry[] = [
  { name: 'auth.ts', type: 'file', path: 'src/auth.ts', extension: '.ts' },
  { name: 'src', type: 'directory', path: 'src' },
];

function setup() {
  const get = vi.fn(async () => ({ files }));
  const client = { httpClient: { get } } as unknown as ProkopaiClient;
  const onSendMessage = vi.fn();
  render(<MessageInput session={session} sessionId={session.id} workspaceId="ws" sdkClient={client}
    onSendMessage={onSendMessage} />);
  return { get, onSendMessage, composer: getComposer() };
}

test('@ searches the session checkout and inserts the picked file as a chip', async () => {
  const { get, onSendMessage, composer } = setup();
  typeInComposer(composer, 'fix @aut');
  const [file, folder] = await screen.findAllByRole('option');
  // Name first with the matched letters marked, then the folder.
  expect(file).toHaveTextContent('auth.tssrc');
  expect(file.querySelector('mark')).toHaveTextContent('a');
  expect(file).toHaveAttribute('aria-selected', 'true');
  expect(folder).toHaveAttribute('title', 'src/');
  expect(get).toHaveBeenLastCalledWith('/workspaces/ws/files', expect.objectContaining({
    params: { search: 'aut', showHidden: 'true', root: '/repo/.worktrees/feature' },
  }));
  pressInComposer(composer, 'Enter');
  expect(composerText(composer)).toBe('fix [auth.ts](src/auth.ts) ');
  expect(onSendMessage).not.toHaveBeenCalled();

  pressInComposer(composer, 'Enter');
  expect(onSendMessage).toHaveBeenCalledWith('fix [auth.ts](src/auth.ts)', undefined, undefined);
});

test('an empty @ asks for changed files; Escape closes until the next keystroke', async () => {
  const { get, composer } = setup();
  typeInComposer(composer, '@');
  expect(await screen.findByText('Changed files')).toBeInTheDocument();
  expect(get).toHaveBeenLastCalledWith('/workspaces/ws/files', expect.objectContaining({
    params: { suggest: 'changed', showHidden: 'true', root: '/repo/.worktrees/feature' },
  }));
  pressInComposer(composer, 'Escape');
  expect(screen.queryByText('Changed files')).not.toBeInTheDocument();
});

test('Tab on a folder keeps searching inside it', async () => {
  const { composer } = setup();
  typeInComposer(composer, '@sr');
  const options = await screen.findAllByRole('option');
  // The motionless mousemove a browser sends after scrolling must not take the selection.
  fireEvent.mouseMove(options[1]);
  expect(options[0]).toHaveAttribute('aria-selected', 'true');
  // Arrows wrap at both ends.
  pressInComposer(composer, 'ArrowUp');
  expect(options[1]).toHaveAttribute('aria-selected', 'true');
  pressInComposer(composer, 'ArrowDown');
  expect(options[0]).toHaveAttribute('aria-selected', 'true');
  // Real pointer movement selects the row under it.
  fireEvent.mouseMove(options[1], { movementX: 3, movementY: 1 });
  expect(options[1]).toHaveAttribute('aria-selected', 'true');
  expect(options[0]).toHaveAttribute('aria-selected', 'false');
  pressInComposer(composer, 'Tab');
  expect(composerText(composer)).toBe('@src/');
});

test('references inserted from other panels land in the composer or the saved draft', async () => {
  const { composer } = setup();
  typeInComposer(composer, 'see');
  act(() => insertIntoComposer(session.id, { kind: 'terminal', id: 't1', label: 'zsh', text: 'ok' }));
  expect(composerText(composer)).toBe('see [zsh · 1 line](#context-t1)\n\n<prokop_context>\n<terminal id="t1" label="zsh">\nok\n</terminal>\n</prokop_context>');

  insertIntoComposer('closed-session', { kind: 'file', path: 'README.md' });
  expect(loadDraft('closed-session')).toBe('[README.md](README.md) ');
});
