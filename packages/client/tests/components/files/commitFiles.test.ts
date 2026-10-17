import { expect, test } from 'vitest';
import { commitFiles, parseCommitPatch, splitPath } from '@/components/files/commitFiles';

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1,2 @@',
  '+hello',
  '+world',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  'index 4444444..0000000',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
  '',
].join('\n');

test('rows carry status letters and line counts from the parsed patch', () => {
  const parsed = parseCommitPatch(patch);
  expect(parsed.error).toBeNull();
  const rows = commitFiles(['src/a.ts', 'new.txt', 'gone.txt', 'image.png'], parsed.files);
  expect(rows.map((row) => [row.path, row.status, row.additions, row.deletions, row.diff !== null])).toEqual([
    ['src/a.ts', 'M', 1, 1, true],
    ['new.txt', 'A', 2, 0, true],
    ['gone.txt', 'D', 0, 1, true],
    ['image.png', 'M', 0, 0, false],
  ]);
});

test('patch-only files are appended so every diff is reachable', () => {
  const parsed = parseCommitPatch(patch);
  expect(commitFiles(['new.txt'], parsed.files).map((row) => row.path)).toEqual(['new.txt', 'src/a.ts', 'gone.txt']);
});

test('empty patch yields no files and no error', () => {
  expect(parseCommitPatch('')).toEqual({ files: [], error: null });
  expect(commitFiles([], [])).toEqual([]);
});

test('splitPath separates the file name from its folder', () => {
  expect(splitPath('src/lib/a.ts')).toEqual({ name: 'a.ts', folder: 'src/lib' });
  expect(splitPath('README.md')).toEqual({ name: 'README.md', folder: '' });
});
