import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { GroupComposer } from '@/components/groups/GroupComposer';
import { composerText, getComposer, pressInComposer, typeInComposer } from '../../composerHelpers';

afterEach(cleanup);

const PLACEHOLDER = 'Message the group  (@ who should answer)';
const members = [
  { agentId: 'implementer', name: 'Implementer' },
  { agentId: 'reviewer', name: 'Reviewer' },
  { agentId: 'idea-architect', name: 'Idea Architect' },
];

function setup(onSend = vi.fn()) {
  render(<GroupComposer members={members} defaultAgentId="implementer" onSend={onSend} />);
  return { onSend, composer: getComposer(PLACEHOLDER) };
}

test('typing @ lists matching members, Enter writes the name, and the send names the member', async () => {
  const { onSend, composer } = setup();
  typeInComposer(composer, 'check it @rev');
  expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Reviewer']);
  pressInComposer(composer, 'Enter');
  expect(composerText(composer)).toBe('check it @Reviewer ');
  expect(onSend).not.toHaveBeenCalled();

  pressInComposer(composer, 'Enter');
  expect(onSend).toHaveBeenCalledWith('check it @Reviewer', ['reviewer']);
  await vi.waitFor(() => expect(composerText(composer)).toBe(''));
});

test('everyone is offered as routing in the text; arrows and Escape work the list; Shift+Enter never sends', async () => {
  const { onSend, composer } = setup();
  typeInComposer(composer, '@e');
  expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Implementer', 'Reviewer', 'Idea Architect', 'everyoneall members']);
  pressInComposer(composer, 'ArrowUp');
  expect(screen.getAllByRole('option').at(-1)).toHaveAttribute('aria-selected', 'true');
  pressInComposer(composer, 'Enter');
  expect(composerText(composer)).toBe('@everyone ');
  // The editor's delayed refocus after a pick lands before the next list opens, as it does in a browser.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  typeInComposer(composer, '@everyone status @');
  expect(await screen.findByRole('listbox')).toBeInTheDocument();
  pressInComposer(composer, 'Enter', { shiftKey: true });
  expect(onSend).not.toHaveBeenCalled();
  // Escape dismisses the list: the next Enter sends instead of picking.
  pressInComposer(composer, 'Escape');
  pressInComposer(composer, 'Enter');
  expect(onSend).toHaveBeenCalledWith('@everyone status @', []);
});

test('a message that names nobody says who gets it; an empty one does not send; a deleted name no longer routes', () => {
  const { onSend, composer } = setup();
  pressInComposer(composer, 'Enter');
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

  typeInComposer(composer, 'thanks all');
  expect(screen.getByText('Goes to Implementer')).toBeInTheDocument();
  typeInComposer(composer, 'thanks @Reviewer');
  expect(screen.queryByText(/Goes to/)).not.toBeInTheDocument();

  typeInComposer(composer, 'hi @imp');
  pressInComposer(composer, 'Tab');
  expect(composerText(composer)).toBe('hi @Implementer ');
  typeInComposer(composer, 'hi there');
  pressInComposer(composer, 'Enter');
  expect(onSend).toHaveBeenCalledWith('hi there', []);
});

test('a slash prompt lists matches, Enter writes the command, and the send expands it with the rest while a mention in the rest still routes', async () => {
  const onSend = vi.fn();
  const prompts = [
    { name: 'review', description: 'Review changes', content: 'Review this change: ARG' },
    { name: 'explain', description: 'Explain changes', content: 'Explain this change' },
  ];
  render(<GroupComposer members={members} defaultAgentId="implementer" prompts={prompts} onSend={onSend} />);
  const composer = getComposer('Message the group  (/ prompts, @ who should answer)');
  typeInComposer(composer, '/rev');
  expect(await screen.findByText('/review')).toBeInTheDocument();
  expect(screen.queryByText('/explain')).not.toBeInTheDocument();
  pressInComposer(composer, 'Enter');
  expect(composerText(composer)).toBe('/review ');
  expect(onSend).not.toHaveBeenCalled();

  typeInComposer(composer, '/review @Reviewer src/main.ts');
  pressInComposer(composer, 'Enter');
  expect(onSend).toHaveBeenCalledWith('Review this change: @Reviewer src/main.ts', []);

  typeInComposer(composer, '/explain the queue');
  pressInComposer(composer, 'Enter');
  expect(onSend).toHaveBeenLastCalledWith('Explain this change\nthe queue', []);
  typeInComposer(composer, '/unknown thing');
  pressInComposer(composer, 'Enter');
  expect(onSend).toHaveBeenLastCalledWith('/unknown thing', []);
});

test('while members work the send button is Stop until something is typed', () => {
  const onStop = vi.fn();
  const onSend = vi.fn();
  render(<GroupComposer members={members} defaultAgentId="implementer" working onStop={onStop} onSend={onSend} />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(onStop).toHaveBeenCalledTimes(1);

  const composer = getComposer(PLACEHOLDER);
  typeInComposer(composer, 'one more thing');
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  pressInComposer(composer, 'Enter');
  expect(onSend).toHaveBeenCalledWith('one more thing', []);
});

test('the shield shows the group mode and picking another one reports it for the whole group', async () => {
  const onPermissionModeChange = vi.fn();
  render(<GroupComposer members={members} defaultAgentId="implementer" permissionMode="extended" onPermissionModeChange={onPermissionModeChange} onSend={vi.fn()} />);
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Extended permissions' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Full access' }));
  });
  expect(onPermissionModeChange).toHaveBeenCalledWith('full');
});
