import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { afterEach, expect, test, vi } from 'vitest';
import { TerminalAddToChat, TERMINAL_CONTEXT_MAX_CHARS, normalizeTerminalSelection } from '@/components/layout/TerminalAddToChat';
import { clearDraft, loadDraft } from '@/config/draftStorage';

afterEach(() => clearDraft('s1'));

function fakeTerminal(selection: string) {
  let listener: (() => void) | null = null;
  let selected = '';
  const terminal = {
    hasSelection: () => selected.length > 0,
    getSelection: () => selected,
    clearSelection: vi.fn(() => { selected = ''; listener?.(); }),
    onSelectionChange: (callback: () => void) => {
      listener = callback;
      return { dispose: () => { listener = null; } };
    },
  };
  const select = () => act(() => { selected = selection; listener?.(); });
  return { terminal: terminal as unknown as Terminal, select, clearSelection: terminal.clearSelection };
}

test('shows only while text is selected and sends it to the focused session', () => {
  const { terminal, select, clearSelection } = fakeTerminal('\n$ bun test   \r\n1 fail  \n\n');
  render(<TerminalAddToChat terminal={terminal} label="zsh" cwd="/repo" sessionId="s1" />);
  expect(screen.queryByRole('button', { name: /Add to chat/ })).not.toBeInTheDocument();
  select();
  fireEvent.click(screen.getByRole('button', { name: /Add to chat/ }));
  expect(clearSelection).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Add to chat/ })).not.toBeInTheDocument();
  // No composer is mounted for s1, so the reference lands in its draft.
  expect(loadDraft('s1')).toMatch(/^\[zsh · 2 lines\]\(#context-t[a-z0-9]+\)\n\n<prokop_context>\n<terminal id="t[a-z0-9]+" label="zsh" cwd="\/repo">\n\$ bun test\n1 fail\n<\/terminal>\n<\/prokop_context>$/);
});

test('is disabled without a focused session', () => {
  const { terminal, select } = fakeTerminal('output');
  render(<TerminalAddToChat terminal={terminal} label="zsh" sessionId={null} />);
  select();
  expect(screen.getByRole('button', { name: /Add to chat/ })).toBeDisabled();
});

test('long selections keep their last whole lines', () => {
  const line = 'x'.repeat(99);
  const text = Array.from({ length: 1000 }, (_, index) => `${index} ${line}`).join('\n');
  const normalized = normalizeTerminalSelection(text);
  expect(normalized.length).toBeLessThanOrEqual(TERMINAL_CONTEXT_MAX_CHARS);
  expect(normalized.endsWith(`999 ${line}`)).toBe(true);
  expect(normalized.split('\n')[0]).toMatch(/^\d+ x+$/);
});
