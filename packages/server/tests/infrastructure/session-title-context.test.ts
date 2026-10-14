import { expect, test } from 'bun:test';
import { formatContextReference, joinContextEnvelope, type MessageWithParts } from '@prokopai/sdk';
import { fallbackSessionTitle } from '@prokopai/core/infrastructure/session-title';

test('fallback titles read context references as paths and skip captured terminal output', () => {
  const terminal = { kind: 'terminal' as const, id: 't1', label: 'zsh', text: 'secretToken leaked in logs' };
  const text = joinContextEnvelope(`Fix [auth.ts](src/auth.ts) after ${formatContextReference(terminal)}`, [terminal]);
  const messages = [{
    message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 1 },
    parts: [{ id: 'p1', messageId: 'm1', createdAt: 1, type: 'text', text }],
  }] as MessageWithParts[];
  const title = fallbackSessionTitle(messages) ?? '';
  expect(title).toContain('auth');
  expect(title).not.toMatch(/secretToken|prokop_context|context-t1/);
});
