/**
 * Fuzzy ranking for `@` file references over the paths the file tree feed
 * already holds. Scoring favors, in order: an exact or prefix basename match,
 * a basename substring, a path substring, then an in-order subsequence whose
 * characters start path segments or words. Changed files rank above others.
 */

import { extname } from 'path';
import type { FileEntry } from '@prokopai/sdk';

export interface RankFilePathsOptions {
  limit: number;
  /** Ignored paths, as listed by the tree (folders with a trailing slash). */
  ignored?: ReadonlySet<string>;
  /** Root-relative files with Git changes; they rank higher. */
  changed?: ReadonlySet<string>;
  showHidden?: boolean;
}

const CHANGED_BONUS = 150;
const BOUNDARY = /[/\-_.\s]/;

function isBoundary(path: string, index: number): boolean {
  if (index === 0) return true;
  const previous = path[index - 1];
  if (BOUNDARY.test(previous)) return true;
  // camelCase: a capital after a lowercase letter starts a word.
  return path[index] !== path[index].toLowerCase() && previous === previous.toLowerCase();
}

const MAX_SUBSEQUENCE_STARTS = 8;

/** Greedy in-order match from one start; null when a character is missing or the match sprawls. */
function subsequenceFrom(path: string, lowerPath: string, query: string, start: number): number | null {
  let score = isBoundary(path, start) ? 6 : 0;
  let previous = start;
  for (let i = 1; i < query.length; i++) {
    const index = lowerPath.indexOf(query[i], previous + 1);
    if (index === -1) return null;
    if (index === previous + 1) score += 8;
    else score -= Math.min(index - previous, 20) * 0.5;
    if (isBoundary(path, index)) score += 6;
    previous = index;
  }
  // Letters scattered across a long path are noise, not a match.
  if (previous - start + 1 > query.length * 2 + 4) return null;
  return score;
}

/** Best in-order subsequence score over the first few starts, or null. */
function subsequenceScore(path: string, lowerPath: string, query: string, from: number): number | null {
  let best: number | null = null;
  let start = lowerPath.indexOf(query[0], from);
  for (let tries = 0; start !== -1 && tries < MAX_SUBSEQUENCE_STARTS; tries++) {
    const score = subsequenceFrom(path, lowerPath, query, start);
    if (score !== null && (best === null || score > best)) best = score;
    start = lowerPath.indexOf(query[0], start + 1);
  }
  return best;
}

function scorePath(path: string, query: string, queryHasSlash: boolean): number | null {
  const isDirectory = path.endsWith('/');
  const clean = isDirectory ? path.slice(0, -1) : path;
  const lowerPath = clean.toLowerCase();
  const nameStart = clean.lastIndexOf('/') + 1;
  const lowerName = lowerPath.slice(nameStart);
  const lowerQuery = queryHasSlash ? query.replace(/\/$/, '') : query;

  let score: number;
  if (!queryHasSlash && lowerName === lowerQuery) score = 1000;
  else if (!queryHasSlash && lowerName.startsWith(lowerQuery)) score = 800;
  else if (!queryHasSlash && lowerName.includes(lowerQuery)) score = 600;
  else if (lowerPath.includes(lowerQuery)) score = 400 + (lowerPath.endsWith(lowerQuery) ? 50 : 0);
  else {
    // Prefer a match inside the basename; fall back to the whole path.
    const inName = queryHasSlash ? null : subsequenceScore(clean, lowerPath, lowerQuery, nameStart);
    const inPath = inName === null ? subsequenceScore(clean, lowerPath, lowerQuery, 0) : null;
    if (inName === null && inPath === null) return null;
    score = inName !== null ? 200 + inName : 100 + (inPath ?? 0);
  }
  const depth = clean.split('/').length - 1;
  score -= depth * 2 + clean.length * 0.05;
  if (isDirectory && !query.endsWith('/')) score -= 20;
  return score;
}

function isHiddenPath(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.') && segment.length > 1);
}

function isIgnored(path: string, ignored: ReadonlySet<string> | undefined): boolean {
  if (!ignored || ignored.size === 0) return false;
  if (ignored.has(path)) return true;
  // Contents of an ignored folder (only present when it was expanded) are ignored too.
  let slash = path.indexOf('/');
  while (slash !== -1 && slash < path.length - 1) {
    if (ignored.has(path.slice(0, slash + 1))) return true;
    slash = path.indexOf('/', slash + 1);
  }
  return false;
}

export function toFileEntry(path: string): FileEntry {
  const isDirectory = path.endsWith('/');
  const clean = isDirectory ? path.slice(0, -1) : path;
  return {
    name: clean.slice(clean.lastIndexOf('/') + 1),
    type: isDirectory ? 'directory' : 'file',
    path: clean,
    extension: isDirectory ? undefined : extname(clean),
  };
}

/** Best matches first. `paths` are root-relative; folders end with `/`. */
export function rankFilePaths(paths: readonly string[], rawQuery: string, options: RankFilePathsOptions): FileEntry[] {
  const query = rawQuery.trim().replace(/^@/, '').replace(/^\.\//, '').toLowerCase();
  if (!query) return [];
  const queryHasSlash = query.includes('/');
  const scored: Array<{ path: string; score: number }> = [];
  for (const path of paths) {
    if (!options.showHidden && isHiddenPath(path)) continue;
    if (isIgnored(path, options.ignored)) continue;
    const score = scorePath(path, query, queryHasSlash);
    if (score === null) continue;
    scored.push({ path, score: score + (options.changed?.has(path) ? CHANGED_BONUS : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, options.limit).map(({ path }) => toFileEntry(path));
}
