import { describe, expect, it } from 'vitest';
import {
  docMatchesDeleteTarget,
  isUnderPath,
  joinCopyAbsolutePath,
  joinRootRelative,
  moveDestination,
  parentDirectory,
  planTreeDrop,
  stripTrailingSlash,
  validateEntryName,
  validateMoveTarget,
  validateRenameTarget,
} from '@/components/files/fileActionsCore';

describe('moving an entry into a folder', () => {
  it('keeps the name and takes the new parent, the root included', () => {
    expect(parentDirectory('src/auth/session.ts')).toBe('src/auth');
    expect(parentDirectory('README.md')).toBe('');
    expect(moveDestination('src/auth/session.ts', 'lib')).toBe('lib/session.ts');
    expect(moveDestination('src/auth/', '')).toBe('auth');
    expect(moveDestination('README.md', 'docs/')).toBe('docs/README.md');
  });
  it('refuses the same folder, a folder inside itself, and bad paths', () => {
    expect(validateMoveTarget('src/auth/session.ts', false, 'src/auth')).toBe('Already in src/auth');
    expect(validateMoveTarget('README.md', false, '')).toBe('Already in the workspace root');
    expect(validateMoveTarget('src/auth', true, 'src/auth/tokens')).toBe('A folder cannot be moved into itself');
    expect(validateMoveTarget('src/auth', true, 'src/auth')).toBe('A folder cannot be moved into itself');
    expect(validateMoveTarget('src/auth', true, '../elsewhere')).toBe('Name must not contain ".." segments');
    expect(validateMoveTarget('src/auth/session.ts', false, 'lib')).toBeNull();
    expect(validateMoveTarget('src/auth', true, 'src/authentication')).toBeNull();
  });
  it('plans a tree drop from Pierre ids: folders end with a slash, the root target is null, one bad entry refuses all', () => {
    expect(planTreeDrop(['src/auth/session.ts', 'src/auth/'], 'lib/')).toEqual({
      moves: [
        { from: 'src/auth/session.ts', to: 'lib/session.ts', isDirectory: false },
        { from: 'src/auth', to: 'lib/auth', isDirectory: true },
      ],
      error: null,
    });
    expect(planTreeDrop(['src/auth/session.ts'], null)).toEqual({ moves: [{ from: 'src/auth/session.ts', to: 'session.ts', isDirectory: false }], error: null });
    expect(planTreeDrop(['src/auth/session.ts', 'lib/x.ts'], 'lib/')).toEqual({ moves: [], error: 'Already in lib' });
    expect(planTreeDrop(['src/'], 'src/auth/')).toEqual({ moves: [], error: 'A folder cannot be moved into itself' });
  });
});

describe('stripTrailingSlash', () => {
  it('removes one trailing slash', () => {
    expect(stripTrailingSlash('src/')).toBe('src');
  });
  it('removes repeated trailing slashes', () => {
    expect(stripTrailingSlash('src///')).toBe('src');
  });
  it('leaves bare paths untouched', () => {
    expect(stripTrailingSlash('src/a.ts')).toBe('src/a.ts');
  });
  it('maps root to empty string', () => {
    expect(stripTrailingSlash('/')).toBe('');
  });
});

describe('joinRootRelative', () => {
  it('joins parent and name', () => {
    expect(joinRootRelative('src', 'a.ts')).toBe('src/a.ts');
  });
  it('accepts trailing-slash parents', () => {
    expect(joinRootRelative('src/', 'a.ts')).toBe('src/a.ts');
  });
  it('treats empty parent as root', () => {
    expect(joinRootRelative('', 'a.ts')).toBe('a.ts');
  });
  it('strips a leading slash from the name', () => {
    expect(joinRootRelative('src', '/a.ts')).toBe('src/a.ts');
  });
});

describe('isUnderPath', () => {
  it('matches exact paths', () => {
    expect(isUnderPath('src', 'src')).toBe(true);
  });
  it('matches descendants', () => {
    expect(isUnderPath('src', 'src/lib/a.ts')).toBe(true);
  });
  it('rejects sibling prefixes', () => {
    expect(isUnderPath('src', 'srcx/a.ts')).toBe(false);
  });
  it('rejects partial segment matches', () => {
    expect(isUnderPath('src', 'src.old/a.ts')).toBe(false);
  });
  it('empty prefix matches everything (workspace root)', () => {
    expect(isUnderPath('', 'anything.ts')).toBe(true);
  });
  it('accepts trailing-slash prefix', () => {
    expect(isUnderPath('src/', 'src/a.ts')).toBe(true);
  });
});

describe('validateEntryName', () => {
  it('accepts simple names', () => {
    expect(validateEntryName('a.ts')).toBeNull();
  });
  it('accepts nested paths', () => {
    expect(validateEntryName('a/b/c.ts')).toBeNull();
  });
  it('rejects empty and whitespace-only names', () => {
    expect(validateEntryName('')).toMatch(/required/i);
    expect(validateEntryName('   ')).toMatch(/required/i);
  });
  it('rejects leading or trailing slashes', () => {
    expect(validateEntryName('/a.ts')).toMatch(/slash/i);
    expect(validateEntryName('a.ts/')).toMatch(/slash/i);
  });
  it('rejects empty segments', () => {
    expect(validateEntryName('a//b.ts')).toMatch(/empty/i);
  });
  it('rejects parent directory segments', () => {
    expect(validateEntryName('../a.ts')).toMatch(/\.\./);
  });
});

describe('validateRenameTarget', () => {
  it('rejects unchanged paths', () => {
    expect(validateRenameTarget('src/a.ts', 'src/a.ts')).toMatch(/differ/i);
  });
  it('accepts a real rename', () => {
    expect(validateRenameTarget('src/b.ts', 'src/a.ts')).toBeNull();
  });
  it('still applies name rules', () => {
    expect(validateRenameTarget('../b.ts', 'src/a.ts')).toMatch(/\.\./);
  });
});

describe('docMatchesDeleteTarget', () => {
  const identity = {
    serverId: 's1',
    workspaceId: 'w1',
    root: '',
    path: 'src/lib/a.ts',
  };

  it('matches a file delete exactly', () => {
    expect(docMatchesDeleteTarget(identity, { path: 'src/lib/a.ts', isDirectory: false })).toBe(true);
  });
  it('rejects other files', () => {
    expect(docMatchesDeleteTarget(identity, { path: 'src/lib/b.ts', isDirectory: false })).toBe(false);
  });
  it('matches a directory delete by prefix', () => {
    expect(docMatchesDeleteTarget(identity, { path: 'src/lib', isDirectory: true })).toBe(true);
  });
  it('rejects sibling directory prefixes', () => {
    expect(docMatchesDeleteTarget(identity, { path: 'src/libx', isDirectory: true })).toBe(false);
  });
  it('rejects on serverId mismatch', () => {
    expect(
      docMatchesDeleteTarget(identity, { serverId: 's2', path: 'src/lib/a.ts', isDirectory: false }),
    ).toBe(false);
  });
  it('rejects on workspaceId mismatch', () => {
    expect(
      docMatchesDeleteTarget(identity, { workspaceId: 'w2', path: 'src/lib/a.ts', isDirectory: false }),
    ).toBe(false);
  });
  it('rejects on root mismatch', () => {
    expect(
      docMatchesDeleteTarget(identity, { root: '/other', path: 'src/lib/a.ts', isDirectory: false }),
    ).toBe(false);
  });
});

describe('joinCopyAbsolutePath', () => {
  it('joins workspace and relative path', () => {
    expect(joinCopyAbsolutePath('/Users/x/work', 'src/a.ts')).toBe('/Users/x/work/src/a.ts');
  });
  it('returns the relative path without a workspace', () => {
    expect(joinCopyAbsolutePath(undefined, 'src/a.ts')).toBe('src/a.ts');
  });
  it('trims trailing slashes off the workspace', () => {
    expect(joinCopyAbsolutePath('/Users/x/work/', 'src/a.ts')).toBe('/Users/x/work/src/a.ts');
  });
  it('trims a leading slash off the relative path', () => {
    expect(joinCopyAbsolutePath('/Users/x/work', '/src/a.ts')).toBe('/Users/x/work/src/a.ts');
  });
});
