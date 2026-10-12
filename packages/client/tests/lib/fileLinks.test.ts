import { describe, expect, test } from 'vitest';
import { localFileLinkPath } from '@/lib/fileLinks';

describe('localFileLinkPath', () => {
  test('reads workspace-relative and absolute paths', () => {
    expect(localFileLinkPath('.claude/skills/out/release-notes-20261006-090728.xlsx'))
      .toBe('.claude/skills/out/release-notes-20261006-090728.xlsx');
    expect(localFileLinkPath('./src/app.ts')).toBe('src/app.ts');
    expect(localFileLinkPath('/Users/me/Work/app/src/app.ts')).toBe('/Users/me/Work/app/src/app.ts');
    expect(localFileLinkPath('~/Downloads/report.pdf')).toBe('~/Downloads/report.pdf');
    expect(localFileLinkPath('<docs/My File.md>')).toBe('docs/My File.md');
  });

  test('drops line references and decodes escapes', () => {
    expect(localFileLinkPath('src/app.ts#L12-L20')).toBe('src/app.ts');
    expect(localFileLinkPath('/repo/src/app.ts:42')).toBe('/repo/src/app.ts');
    expect(localFileLinkPath('/repo/src/app.ts:42:7')).toBe('/repo/src/app.ts');
    expect(localFileLinkPath('docs/My%20File.md')).toBe('docs/My File.md');
  });

  test('reads file URLs, including Windows drives', () => {
    expect(localFileLinkPath('file:///Users/me/My%20Notes.md')).toBe('/Users/me/My Notes.md');
    expect(localFileLinkPath('file:///C:/work/a.txt')).toBe('C:/work/a.txt');
    expect(localFileLinkPath('C:\\work\\a.txt')).toBe('C:\\work\\a.txt');
  });

  test('leaves web links and in-page anchors alone', () => {
    for (const href of ['https://example.com/a.xlsx', 'http://localhost:3000/x', 'mailto:a@b.c', '//cdn.example/x.js', '#heading', '?q=1', '', '.']) {
      expect(localFileLinkPath(href)).toBeNull();
    }
  });
});
