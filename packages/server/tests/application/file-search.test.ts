import { describe, expect, test } from 'bun:test';
import { rankFilePaths } from '@/application/files/file-search';

const paths = [
  'packages/',
  'packages/client/',
  'packages/client/src/',
  'packages/client/src/components/chat/MessageInput.tsx',
  'packages/client/src/components/chat/MessageBubble.tsx',
  'packages/client/src/hooks/useFileSearch.ts',
  'packages/server/src/application/files/index.ts',
  'packages/server/src/index.ts',
  'README.md',
  '.github/workflows/release.yml',
  'node_modules/',
  'node_modules/react/index.js',
];

function rank(query: string, options: Partial<Parameters<typeof rankFilePaths>[2]> = {}): string[] {
  return rankFilePaths(paths, query, { limit: 5, showHidden: true, ...options }).map((entry) => entry.path);
}

describe('rankFilePaths', () => {
  test('basename prefix beats path substring', () => {
    expect(rank('messagein')[0]).toBe('packages/client/src/components/chat/MessageInput.tsx');
  });

  test('fuzzy subsequence matches word starts', () => {
    expect(rank('msgb')[0]).toBe('packages/client/src/components/chat/MessageBubble.tsx');
    expect(rank('ufs')[0]).toBe('packages/client/src/hooks/useFileSearch.ts');
  });

  test('a slash in the query matches against the path', () => {
    expect(rank('server/index')[0]).toBe('packages/server/src/index.ts');
  });

  test('shallower paths win ties', () => {
    expect(rank('index.ts')).toEqual([
      'packages/server/src/index.ts',
      'packages/server/src/application/files/index.ts',
    ]);
  });

  test('changed files rank higher', () => {
    const changed = new Set(['packages/server/src/application/files/index.ts']);
    expect(rank('index.ts', { changed })[0]).toBe('packages/server/src/application/files/index.ts');
  });

  test('ignored paths and their contents are excluded', () => {
    expect(rank('react', { ignored: new Set(['node_modules/']) })).toEqual([]);
  });

  test('hidden paths follow the showHidden option', () => {
    expect(rank('release')).toEqual(['.github/workflows/release.yml']);
    expect(rank('release', { showHidden: false })).toEqual([]);
  });

  test('folders keep their type and drop the trailing slash', () => {
    const [entry] = rankFilePaths(paths, 'client/', { limit: 1, showHidden: true });
    expect(entry).toEqual({ name: 'client', type: 'directory', path: 'packages/client', extension: undefined });
  });

  test('a leading @ or ./ is ignored and empty queries return nothing', () => {
    expect(rank('@readme')).toEqual(['README.md']);
    expect(rank('./readme')).toEqual(['README.md']);
    expect(rank('  ')).toEqual([]);
  });
});
