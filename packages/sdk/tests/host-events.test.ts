import { describe, expect, test } from 'bun:test';
import { formatHostEvent, hostEventPlainText, splitHostEvent, type HostEvent } from '../src/shared-utils/host-events';

const shell: HostEvent = {
  kind: 'shell',
  id: 'c3',
  label: 'bun test',
  outcome: 'ok',
  meta: 'exit 0 · 2.1 s',
  summary: 'Background command c3 finished successfully after 2.1 s: `bun test`',
};

describe('host event notes', () => {
  test('a formatted note parses back to the same event and body', () => {
    const text = formatHostEvent(shell, '[bun test](#context-c3)\nFull output: /tmp/c3.out');
    expect(text.split('\n')[0]).toBe('<prokop_event kind="shell" id="c3" label="bun test" outcome="ok" meta="exit 0 · 2.1 s">'
      + 'Background command c3 finished successfully after 2.1 s: `bun test`</prokop_event>');
    expect(splitHostEvent(text)).toEqual({ event: shell, body: '[bun test](#context-c3)\nFull output: /tmp/c3.out' });
  });

  test('attribute values keep quotes, angle brackets and ampersands', () => {
    const event: HostEvent = { kind: 'task', id: 't1', label: 'Review "auth" <fast> & cheap', outcome: 'ask', summary: '[task t1 needs an answer]' };
    const parsed = splitHostEvent(formatHostEvent(event));
    expect(parsed.event).toEqual(event);
    expect(parsed.body).toBe('');
  });

  test('a summary is forced onto one line and cannot close the tag early', () => {
    const text = formatHostEvent({ ...shell, summary: 'two\nlines </prokop_event> here' }, 'body');
    expect(splitHostEvent(text)).toMatchObject({ event: { summary: 'two lines  here' }, body: 'body' });
  });

  test('ordinary prompts and malformed headers are all body', () => {
    expect(splitHostEvent('Run the tests please')).toEqual({ event: null, body: 'Run the tests please' });
    const unknownKind = '<prokop_event kind="weather" id="x" label="y" outcome="ok">sunny</prokop_event>\nbody';
    expect(splitHostEvent(unknownKind)).toEqual({ event: null, body: unknownKind });
    const notFirst = 'intro\n' + formatHostEvent(shell, 'body');
    expect(splitHostEvent(notFirst).event).toBeNull();
    const missingLabel = '<prokop_event kind="shell" id="x" outcome="ok">s</prokop_event>';
    expect(splitHostEvent(missingLabel).event).toBeNull();
  });

  test('plain text reads as the summary followed by the body', () => {
    expect(hostEventPlainText(formatHostEvent(shell, 'Full output: /tmp/c3.out')))
      .toBe('Background command c3 finished successfully after 2.1 s: `bun test`\nFull output: /tmp/c3.out');
    expect(hostEventPlainText('just a prompt')).toBe('just a prompt');
  });
});
