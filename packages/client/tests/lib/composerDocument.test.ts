import { describe, expect, test } from 'vitest';
import { formatContextReference, joinContextEnvelope, type TerminalContextReference } from '@prokopai/sdk';
import { documentToPrompt, promptToDocument } from '@/lib/composerDocument';

const terminal: TerminalContextReference = { kind: 'terminal', id: 't1', label: 'zsh', text: '$ ls\nREADME.md' };

describe('composer document', () => {
  test('lines become paragraphs and references become chips', () => {
    const doc = promptToDocument('fix [auth.ts:3](src/auth.ts#L3)\n\nthanks');
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [
        { type: 'text', text: 'fix ' },
        { type: 'contextReference', attrs: { reference: { kind: 'file', path: 'src/auth.ts', lineStart: 3 } } },
      ] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'thanks' }] },
    ]);
  });

  test('round trips prompts with terminal envelopes', () => {
    const prompt = joinContextEnvelope(`see ${formatContextReference(terminal)}\nand [src/](src/)`, [terminal]);
    expect(documentToPrompt(promptToDocument(prompt))).toBe(prompt);
  });

  test('empty and plain prompts round trip', () => {
    expect(documentToPrompt(promptToDocument(''))).toBe('');
    expect(documentToPrompt(promptToDocument('a\nb'))).toBe('a\nb');
  });

  test('clipboard slices that start mid-paragraph keep inline text together', () => {
    expect(documentToPrompt({
      type: 'doc',
      content: [
        { type: 'text', text: 'end of ' },
        { type: 'contextReference', attrs: { reference: { kind: 'file', path: 'a.ts' } } },
        { type: 'paragraph', content: [{ type: 'text', text: 'next line' }] },
      ],
    })).toBe('end of [a.ts](a.ts)\nnext line');
  });
});
