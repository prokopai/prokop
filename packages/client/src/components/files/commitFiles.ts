/**
 * Rows for the commit details file list: the server's changed-path list
 * merged with the parsed patch so each row carries a status letter, line
 * counts, and the diff to render. Paths match because the server diffs with
 * `--no-renames`, so a renamed file appears as a delete plus an add.
 */
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { pierreCacheKey } from '@/lib/pierreCacheKey';

export type CommitFileStatus = 'A' | 'M' | 'D' | 'R';

export interface CommitFile {
  path: string;
  status: CommitFileStatus;
  additions: number;
  deletions: number;
  /** Null for files without a text diff (binary, mode-only change). */
  diff: FileDiffMetadata | null;
}

export function parseCommitPatch(patch: string): { files: FileDiffMetadata[]; error: string | null } {
  if (!patch) return { files: [], error: null };
  try {
    return { files: parsePatchFiles(patch, pierreCacheKey('commit', patch), true).flatMap((entry) => entry.files), error: null };
  } catch {
    return { files: [], error: 'Unable to render this commit diff.' };
  }
}

function statusOf(diff: FileDiffMetadata | null): CommitFileStatus {
  switch (diff?.type) {
    case 'new': return 'A';
    case 'deleted': return 'D';
    case 'rename-pure':
    case 'rename-changed': return 'R';
    default: return 'M';
  }
}

export function commitFiles(paths: readonly string[], parsed: readonly FileDiffMetadata[]): CommitFile[] {
  const byName = new Map(parsed.map((file) => [file.name, file]));
  // Keep the server order but also include patch-only entries, so nothing in
  // the patch is unreachable from the list.
  const ordered = [...paths, ...parsed.map((file) => file.name).filter((name) => !paths.includes(name))];
  return ordered.map((path) => {
    const diff = byName.get(path) ?? null;
    let additions = 0;
    let deletions = 0;
    // Hunk-level counts are the `@@` line totals including context; only the
    // change entries carry the added and removed line counts.
    for (const hunk of diff?.hunks ?? []) {
      for (const content of hunk.hunkContent) {
        if (content.type !== 'change') continue;
        additions += content.additions;
        deletions += content.deletions;
      }
    }
    return { path, status: statusOf(diff), additions, deletions, diff };
  });
}

export function splitPath(path: string): { name: string; folder: string } {
  const index = path.lastIndexOf('/');
  return index === -1 ? { name: path, folder: '' } : { name: path.slice(index + 1), folder: path.slice(0, index) };
}
