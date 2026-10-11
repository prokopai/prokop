import { expect, test } from 'vitest';
import type { PullRequestDetail, PullRequestThread } from '@prokopai/sdk';
import { commentMarkdown, openThreads, reviewMarkdown } from '@/components/pullRequests/reviewMarkdown';

const comment = (name: string, body: string) => ({
  id: `${name}:${body}`,
  author: { id: name, name },
  body,
  createdAt: '2026-10-08',
});
const thread = (id: string, patch: Partial<PullRequestThread>): PullRequestThread => ({
  id,
  resolved: false,
  outdated: false,
  canResolve: true,
  comments: [comment('bob', `Thread ${id}`)],
  ...patch,
});
const pr = {
  number: 7,
  title: 'Fix login',
  comments: [comment('carol', 'Looks close.')],
  threads: [
    thread('b', { path: 'src/b.ts', line: 9 }),
    thread('general', {}),
    thread('a2', { path: '/src/a.ts', line: 40, side: 'LEFT' }),
    thread('a1', {
      path: '/src/a.ts',
      line: 3,
      comments: [comment('bob', '  Rename this.\n'), comment('alice', '```ts\nconst x = 1;\n```')],
    }),
    thread('done', { path: 'src/c.ts', line: 1, resolved: true }),
    thread('moved', { path: 'src/d.ts', line: 2, outdated: true }),
  ],
} as unknown as PullRequestDetail;

test('unresolved threads export in file and line order, ready to paste', () => {
  expect(openThreads(pr).map((t) => t.id)).toEqual(['b', 'general', 'a2', 'a1']);
  expect(reviewMarkdown(pr, 'open')).toBe(
    [
      '## Review comments on #7: Fix login',
      '### src/a.ts:3',
      '**bob:**',
      'Rename this.',
      '**alice:**',
      '```ts\nconst x = 1;\n```',
      '### src/a.ts:40 (old)',
      '**bob:**',
      'Thread a2',
      '### src/b.ts:9',
      '**bob:**',
      'Thread b',
      '### General',
      '**bob:**',
      'Thread general',
    ].join('\n\n') + '\n',
  );
});

test('all comments add resolved and outdated threads, marked, and the conversation', () => {
  const all = reviewMarkdown(pr, 'all');
  expect(all).toContain('### src/c.ts:1 (resolved)\n\n**bob:**\n\nThread done');
  expect(all).toContain('### src/d.ts:2 (outdated)');
  expect(all.endsWith('### Conversation\n\n**carol:**\n\nLooks close.\n')).toBe(true);
});

test('one comment copies with its file location; a general comment copies as written', () => {
  const [, general, old] = pr.threads;
  expect(commentMarkdown(old.comments[0], old)).toBe('### src/a.ts:40 (old)\n\n**bob:**\n\nThread a2\n');
  expect(commentMarkdown(general.comments[0], general)).toBe('Thread general');
  expect(commentMarkdown(pr.comments[0])).toBe('Looks close.');
});

test('a review without open threads exports only its heading', () => {
  expect(reviewMarkdown({ ...pr, threads: [] }, 'open')).toBe('## Review comments on #7: Fix login\n');
});
