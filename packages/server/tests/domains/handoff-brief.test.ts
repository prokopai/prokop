import { expect, test } from 'bun:test';
import type { MessageWithParts, Part } from '@prokopai/sdk';
import { buildHandoffBrief } from '@/domains/sessions/handoff-brief';

let next = 0;

function message(role: 'user' | 'assistant', parts: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {}): MessageWithParts {
  const id = `m${next++}`;
  return {
    message: role === 'user'
      ? { id, sessionId: 's', role, createdAt: next }
      : { id, sessionId: 's', role, createdAt: next, status: 'completed', modelId: 'sonnet', providerId: 'p',
        tokens: { prompt: 0, completion: 0 }, cost: 0, ...extra },
    parts: parts.map((part, index) => ({ id: `${id}-${index}`, messageId: id, createdAt: next, ...part }) as Part),
  } as MessageWithParts;
}

const text = (value: string) => ({ type: 'text', text: value });

function conversation(turns: number): MessageWithParts[] {
  return Array.from({ length: turns }, (_, index) => [
    message('user', [text(`request ${index}`)]),
    message('assistant', [text(`reply ${index}`)]),
  ]).flat();
}

test('renders header, tool one-liners and attachments, dropping reasoning', () => {
  const brief = buildHandoffBrief({ sessionId: 'abc', from: 'claude-cli', to: 'codex-cli', messages: [
    message('user', [text('Fix login'), { type: 'image', url: '/x' }, { type: 'file', url: '/y', mimeType: 'text/plain', filename: 'a.log' }]),
    message('assistant', [
      { type: 'reasoning', text: 'secret thinking' },
      { type: 'tool', callId: 'c', name: 'Bash', state: { status: 'completed', input: { command: 'npm test' } },
        presentation: { summary: 'npm test', debugAvailable: false } },
      text('Done.'),
    ]),
  ] });
  expect(brief).toContain('started in Claude Code (sonnet) and now continues in Codex CLI');
  expect(brief).toContain('sessionId "abc"');
  expect(brief).toContain('[image attached]');
  expect(brief).toContain('[file attached: a.log]');
  expect(brief).toContain('- tool Bash: npm test (completed)');
  expect(brief).toContain('Done.');
  expect(brief).not.toContain('secret thinking');
});

test('keeps the first request, one-lines middle turns and the last six turns in full', () => {
  const brief = buildHandoffBrief({ sessionId: 's', from: 'prokop', to: 'claude-cli', messages: conversation(10) });
  expect(brief).toContain('### First request\nrequest 0');
  expect(brief).toContain('### Earlier requests\n- request 1\n- request 2\n- request 3');
  expect(brief).not.toContain('reply 3');
  for (let index = 4; index < 10; index++) expect(brief).toContain(`reply ${index}`);
});

test('skips failed compaction and retry replies, labels summaries', () => {
  const brief = buildHandoffBrief({ sessionId: 's', from: 'prokop', to: 'codex-cli', messages: [
    message('user', [text('go')]),
    message('assistant', [text('failed attempt')], { mode: 'retry_failed' }),
    message('assistant', [text('summary text')], { summary: true, mode: 'compaction' }),
  ] });
  expect(brief).not.toContain('failed attempt');
  expect(brief).toContain('[earlier context summary]\nsummary text');
});

test('folds older turns before truncating to fit the cap', () => {
  const long = 'x'.repeat(1_500);
  const messages = Array.from({ length: 8 }, (_, index) => [
    message('user', [text(`ask ${index} ${long}`)]),
    message('assistant', [text(`answer ${index} ${long}`)]),
  ]).flat();
  const brief = buildHandoffBrief({ sessionId: 's', from: 'prokop', to: 'codex-cli', messages, maxChars: 8_000 });
  expect(brief.length).toBeLessThanOrEqual(8_000 + '\n[handoff truncated]'.length);
  expect(brief).toContain('answer 7');
  expect(brief).not.toContain('answer 2');
  expect(brief).toContain('### First request');
});
