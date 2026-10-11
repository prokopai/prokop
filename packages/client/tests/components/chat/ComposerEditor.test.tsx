import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, test, vi } from 'vitest';
import { ComposerEditor, type ComposerEditorHandle, type ComposerTrigger } from '@/components/chat/ComposerEditor';
import { composerText, getComposer, pressInComposer, typeInComposer } from '../../composerHelpers';

function setup(value = '') {
  const onChange = vi.fn();
  const onTriggerChange = vi.fn<(trigger: ComposerTrigger | null) => void>();
  const onKeyDown = vi.fn<(event: KeyboardEvent) => boolean>(() => false);
  const ref = createRef<ComposerEditorHandle>();
  const view = render(
    <ComposerEditor ref={ref} value={value} onChange={onChange} onTriggerChange={onTriggerChange}
      onKeyDown={onKeyDown} placeholder="Type a message" />,
  );
  return { ...view, ref, onChange, onTriggerChange, onKeyDown, composer: getComposer('Type a message') };
}

test('renders references in the value as chips', async () => {
  setup('look at [auth.ts:3](src/auth.ts#L3) please');
  // Node views mount asynchronously.
  expect(await screen.findByTitle('src/auth.ts:3')).toHaveTextContent('auth.ts:3');
});

test('reports @ and / triggers before the cursor', () => {
  const { composer, onTriggerChange } = setup();
  typeInComposer(composer, 'open @src/au');
  expect(onTriggerChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'file', query: 'src/au' }));
  typeInComposer(composer, '/rev');
  expect(onTriggerChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'prompt', query: 'rev' }));
  typeInComposer(composer, 'mail me@x');
  expect(onTriggerChange).toHaveBeenLastCalledWith(null);
});

test('replacing a trigger inserts a chip and serializes it as a link', () => {
  const { composer, ref, onTriggerChange, onChange } = setup();
  typeInComposer(composer, 'fix @aut');
  const trigger = onTriggerChange.mock.lastCall![0]!;
  act(() => ref.current!.replaceTrigger(trigger, { reference: { kind: 'file', path: 'src/auth.ts' } }));
  expect(composerText(composer)).toBe('fix [auth.ts](src/auth.ts) ');
  expect(onChange).toHaveBeenLastCalledWith('fix [auth.ts](src/auth.ts) ');
});

test('inserted terminal output travels in the envelope', () => {
  const { composer, ref } = setup('logs:');
  act(() => ref.current!.insertReference({ kind: 'terminal', id: 't1', label: 'zsh', text: 'boom' }));
  expect(composerText(composer)).toBe('logs: [zsh · 1 line](#context-t1)\n\n<prokop_context>\n<terminal id="t1" label="zsh">\nboom\n</terminal>\n</prokop_context>');
});

test('keys go to the owner first; Shift+Enter starts a new line', () => {
  const { composer, onKeyDown } = setup();
  typeInComposer(composer, 'one');
  pressInComposer(composer, 'Enter', { shiftKey: true });
  typeInComposer(composer, `${composerText(composer)}two`);
  expect(onKeyDown).toHaveBeenCalled();
  expect(composerText(composer)).toBe('one\ntwo');
});

test('outside value changes replace the content', () => {
  const { rerender, composer, onChange, onKeyDown, onTriggerChange } = setup('draft');
  rerender(<ComposerEditor value="restored" onChange={onChange} onTriggerChange={onTriggerChange}
    onKeyDown={onKeyDown} placeholder="Type a message" />);
  expect(composerText(composer)).toBe('restored');
});
