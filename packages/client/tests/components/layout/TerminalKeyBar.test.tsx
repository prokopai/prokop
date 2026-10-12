import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { expect, test, vi } from 'vitest';
import { TerminalKeyBar } from '@/components/layout/TerminalKeyBar';

function fakeTerminal(applicationCursorKeysMode = false) {
  const terminal = { input: vi.fn(), modes: { applicationCursorKeysMode } };
  return { terminal: terminal as unknown as Terminal, input: terminal.input };
}

test('sends Ctrl+C, Escape and Tab to the shell as user input', () => {
  const { terminal, input } = fakeTerminal();
  render(<TerminalKeyBar terminal={terminal} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C (interrupt)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Escape' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tab' }));
  expect(input.mock.calls).toEqual([['\x03', true], ['\x1b', true], ['\t', true]]);
});

test('arrows follow the application cursor mode', () => {
  const normal = fakeTerminal(false);
  const { unmount } = render(<TerminalKeyBar terminal={normal.terminal} />);
  fireEvent.click(screen.getByRole('button', { name: 'Up' }));
  expect(normal.input).toHaveBeenCalledWith('\x1b[A', true);
  unmount();

  const application = fakeTerminal(true);
  render(<TerminalKeyBar terminal={application.terminal} />);
  fireEvent.click(screen.getByRole('button', { name: 'Left' }));
  expect(application.input).toHaveBeenCalledWith('\x1bOD', true);
});

test('pressing a key keeps focus in the terminal', () => {
  const { terminal } = fakeTerminal();
  render(<TerminalKeyBar terminal={terminal} />);
  const key = screen.getByRole('button', { name: 'Ctrl+C (interrupt)' });
  const mouseDown = createEvent.mouseDown(key);
  fireEvent(key, mouseDown);
  expect(mouseDown.defaultPrevented).toBe(true);
});
