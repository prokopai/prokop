import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { formatHostEvent, joinContextEnvelope, type Message, type Part } from '@prokopai/sdk';
import { MessageRow } from '@/components/chat/TranscriptRow';
import { buildUserPromptMapItems } from '@/components/chat/UserPromptMap';

afterEach(cleanup);

function userItem(text: string, extra: { isQueued?: boolean; queueId?: string; isSteer?: boolean } = {}) {
  const message: Message = { id: 'u1', sessionId: 's1', role: 'user', createdAt: 1 };
  const parts: Part[] = [{ id: 'p1', messageId: 'u1', type: 'text', text, createdAt: 1 }];
  return { message, parts, ...extra };
}

const shellNote = formatHostEvent(
  { kind: 'shell', id: 'c3', label: 'bun test', outcome: 'error', meta: 'exit 1 · 2.1 s',
    summary: 'Background command c3 exited with code 1 after 2.1 s: `bun test`' },
  joinContextEnvelope('[bun test](#context-c3)\nFull output: /tmp/c3.out', [
    { kind: 'terminal', id: 'c3', label: 'bun test', text: '1 fail' },
  ]),
);

const taskNote = formatHostEvent(
  { kind: 'task', id: 'child-1', label: 'Review the auth change', outcome: 'ok', meta: 'codex-cli · gpt-5.5',
    summary: '[task child-1 "Review the auth change" on codex-cli/gpt-5.5 finished]' },
  'task_id: child-1\n<task_result>\nLooks sound.\n</task_result>',
);

test('a finished background command renders as an event row, not a prompt bubble', () => {
  render(<MessageRow item={userItem(shellNote)} revertMessageId="u1" sessionId="s1" onEditMessage={vi.fn()} onRevert={vi.fn()} />);
  const row = screen.getByRole('status');
  expect(row).toHaveAttribute('data-host-event', 'shell');
  expect(row).toHaveTextContent('bun test');
  expect(row).toHaveTextContent('failed');
  expect(row).toHaveTextContent('exit 1 · 2.1 s');
  expect(screen.getByRole('button', { name: 'Terminal output: bun test · 1 line' })).toBeInTheDocument();
  expect(screen.queryByText(/prokop_event/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Background command c3/)).not.toBeInTheDocument();
  // Nothing a person typed: no edit, no revert.
  expect(screen.queryByTitle('Edit message')).not.toBeInTheDocument();
  expect(screen.queryByTitle(/Revert/)).not.toBeInTheDocument();
});

test('a finished task names the task and opens its session', () => {
  const onNavigateToSubagent = vi.fn();
  render(<MessageRow item={userItem(taskNote)} revertMessageId={null} sessionId="s1" onNavigateToSubagent={onNavigateToSubagent} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review the auth change' }));
  expect(onNavigateToSubagent).toHaveBeenCalledWith('child-1');
  expect(screen.getByRole('status')).toHaveTextContent('finished');
  expect(screen.getByRole('status')).toHaveTextContent('codex-cli · gpt-5.5');
  expect(screen.getByText(/Looks sound/)).toBeInTheDocument();
});

test('a queued note says so and can be removed from the queue', () => {
  const onRemoveFromQueue = vi.fn();
  render(<MessageRow item={userItem(taskNote, { isQueued: true, queueId: 'q1' })} revertMessageId={null} sessionId="s1"
    onRemoveFromQueue={onRemoveFromQueue} />);
  expect(screen.getByRole('status')).toHaveTextContent('Pending');
  fireEvent.click(screen.getByTitle('Remove from queue'));
  expect(onRemoveFromQueue).toHaveBeenCalledWith('q1');
});

test('a prompt that only mentions the marker stays an ordinary prompt', () => {
  render(<MessageRow item={userItem('What does <prokop_event kind="shell"> mean?')} revertMessageId={null} sessionId="s1" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText(/What does/)).toBeInTheDocument();
});

test('the prompt map labels a note by its sentence, not the marker', () => {
  const [item] = buildUserPromptMapItems([userItem(shellNote)]);
  expect(item.label.startsWith('Background command c3 exited with code 1')).toBe(true);
  expect(item.label).not.toContain('prokop_event');
});
