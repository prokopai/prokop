import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { formatContextReference, joinContextEnvelope, type Session, type TerminalContextReference } from '@prokopai/sdk';
import { UserPromptText } from '@/components/chat/UserPromptText';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';

const terminal: TerminalContextReference = { kind: 'terminal', id: 't1', label: 'zsh', cwd: '/repo', text: '$ bun test\n1 fail' };
const prompt = joinContextEnvelope(
  `Fix [auth.ts:12-40](src/auth.ts#L12-L40) after ${formatContextReference(terminal)}, see [docs](https://example.com) and [zsh · 3 lines](#context-gone)`,
  [terminal],
);

afterEach(() => {
  useSessionStore.setState({ sessions: [] });
  useUIStore.getState().closeFilePreview();
});

test('references render as chips and the envelope stays hidden', () => {
  render(<UserPromptText text={prompt} sessionId="s1" />);
  expect(screen.getByTitle('src/auth.ts:12-40')).toHaveTextContent('auth.ts:12-40');
  expect(screen.getByRole('button', { name: 'Terminal output: zsh · 2 lines' })).toBeInTheDocument();
  expect(screen.getByTitle('Terminal output was not included')).toHaveTextContent('zsh · 3 lines');
  expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.com');
  expect(screen.queryByText(/prokop_context/)).not.toBeInTheDocument();
  expect(screen.queryByText(/1 fail/)).not.toBeInTheDocument();
});

test('a terminal chip shows the captured output', async () => {
  render(<UserPromptText text={prompt} sessionId="s1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Terminal output: zsh · 2 lines' }));
  expect(await screen.findByText(/1 fail/)).toBeInTheDocument();
  expect(screen.getByText('/repo')).toBeInTheDocument();
});

test('a file chip opens the preview in the session checkout', () => {
  useSessionStore.setState({ sessions: [{
    id: 's1', workspaceId: 'ws', workspaceRootId: 'wt', worktree: { path: '/repo/.worktrees/feature' },
  } as unknown as Session] });
  render(<UserPromptText text={prompt} sessionId="s1" />);
  fireEvent.click(screen.getByTitle('src/auth.ts:12-40'));
  expect(useUIStore.getState().filePreviewTarget).toEqual({
    workspaceId: 'ws', path: 'src/auth.ts', name: 'auth.ts', root: '/repo/.worktrees/feature',
  });
});
