import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { storyCoverageExceptions } from '../../.storybook/coverage';

const componentsRoot = join(import.meta.dirname, '../../src/components');

interface Listing {
  components: string[];
  stories: Set<string>;
}

// Compare against a directory listing, not existsSync: macOS ignores case, CI
// does not, and `alert.tsx` must not pass because `Alert.stories.tsx` exists
// only when the match is spelled out below.
function walk(dir: string, listing: Listing): Listing {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, listing);
      continue;
    }
    if (!entry.endsWith('.tsx')) continue;
    const rel = relative(componentsRoot, full);
    if (entry.endsWith('.stories.tsx')) listing.stories.add(rel);
    else if (!entry.endsWith('.test.tsx')) listing.components.push(rel);
  }
  return listing;
}

function pascalCase(name: string): string {
  return name.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

/** `ui/alert.tsx` is covered by `ui/alert.stories.tsx` or `ui/Alert.stories.tsx`; nothing else. */
function storyCandidates(componentPath: string): string[] {
  const dir = dirname(componentPath);
  const base = basename(componentPath, '.tsx');
  const names = new Set([base, pascalCase(base)]);
  return [...names].map((name) => join(dir, `${name}.stories.tsx`));
}

function hasStory(componentPath: string, stories: Set<string>): boolean {
  return storyCandidates(componentPath).some((candidate) => stories.has(candidate));
}

describe('story coverage', () => {
  const listing = walk(componentsRoot, { components: [], stories: new Set() });
  listing.components.sort();

  test('every component has a story or a documented exception', () => {
    const missing = listing.components.filter((path) => (
      !hasStory(path, listing.stories) && !(path in storyCoverageExceptions)
    ));
    expect(missing, `Components without a story (add X.stories.tsx beside each, or an entry in .storybook/coverage.ts):\n${missing.join('\n')}`).toEqual([]);
  });

  test('exceptions point at components that exist and still have no story', () => {
    const stale = Object.keys(storyCoverageExceptions).filter((path) => !listing.components.includes(path));
    expect(stale, 'Exceptions for files that no longer exist').toEqual([]);

    const redundant = Object.keys(storyCoverageExceptions).filter((path) => hasStory(path, listing.stories));
    expect(redundant, 'Exceptions for components that now have a story').toEqual([]);
  });

  test('exception reasons use the documented vocabulary', () => {
    const invalid = Object.entries(storyCoverageExceptions).filter(([, reason]) => (
      reason !== 'provider' && reason !== 'effect' && !reason.startsWith('covered-by:')
    ));
    expect(invalid).toEqual([]);

    const brokenReferences = Object.entries(storyCoverageExceptions)
      .filter(([, reason]) => reason.startsWith('covered-by:'))
      .filter(([, reason]) => !listing.stories.has(reason.slice('covered-by:'.length)));
    expect(brokenReferences, 'covered-by targets must be existing story files relative to src/components').toEqual([]);
  });

  test('every story file sits beside a component of the same name', () => {
    const orphans = [...listing.stories].filter((storyPath) => {
      const dir = dirname(storyPath);
      const base = basename(storyPath, '.stories.tsx');
      return !listing.components.some((component) => (
        dirname(component) === dir && pascalCase(basename(component, '.tsx')) === pascalCase(base)
      ));
    });
    expect(orphans, 'Story files that do not match a component (rename or move them)').toEqual([]);
  });
});
