import { memo, useMemo, type ComponentProps } from 'react';
import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff, PatchDiff } from '@pierre/diffs/react';
import type { DiffHunk } from '@/utils/diff';
import { pathBasename } from '@/lib/platform';
import { toWorkspaceFileTarget } from '@/lib/path';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore, selectActiveWorkspace } from '@/stores/serverDataStore';
import { useTheme } from '@/components/providers/ThemeProvider';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';
import { hunksToPatch } from '@/lib/hunksToPatch';
import { useVizExpanded } from '@/lib/vizExpansion';
import { PIERRE_THEME_PAIR } from '@/lib/pierreDiffsTheme';
import { pierreCacheKey } from '@/lib/pierreCacheKey';
import { PreviewAction, PreviewFrame } from './PreviewFrame';

type DiffOptions = ComponentProps<typeof FileDiff>['options'];

interface DiffViewerProps {
  hunks: DiffHunk[];
  path: string;
  language?: string;
  additions?: number;
  deletions?: number;
  disablePathOpen?: boolean;
  /** Name the file (and its counts) above the body; off when the tool row already does. */
  showPath?: boolean;
  /** Stable identity (tool-call part id) for persisted expansion state. */
  vizKey?: string;
  matchInfo?: {
    strategy: string;
    lineNumber: number;
  };
}

/**
 * An edit as a peek: the first diff lines behind a fade, "Show all" to grow
 * it inline, "Open file" for the real editor.
 */
export const DiffViewer = memo(function DiffViewer({
  hunks,
  path,
  additions,
  deletions,
  disablePathOpen,
  showPath = false,
  vizKey,
}: DiffViewerProps) {
  const totalDiffLines = useMemo(
    () => hunks.reduce((sum, hunk) => sum + hunk.changes.length, 0),
    [hunks],
  );

  const [expanded, setExpanded] = useVizExpanded(
    vizKey ? `diff:${vizKey}` : `diff:${path}:${totalDiffLines}`,
    false,
  );

  const openFilePreview = useUIStore((s) => s.openFilePreview);
  const activeWorkspace = useServerDataStore(selectActiveWorkspace);

  const { resolvedMode } = useTheme();

  const previewHunks = useMemo(() => {
    if (expanded) return hunks;
    let remaining: number = RENDER_BUDGETS.diffPreviewLines;
    const result: DiffHunk[] = [];
    for (const hunk of hunks) {
      if (remaining <= 0) break;
      if (hunk.changes.length <= remaining) {
        result.push(hunk);
        remaining -= hunk.changes.length;
      } else {
        result.push({ ...hunk, changes: hunk.changes.slice(0, remaining) });
        remaining = 0;
      }
    }
    return result;
  }, [hunks, expanded]);

  const patch = useMemo(() => hunksToPatch(previewHunks, path), [previewHunks, path]);

  // Parsed here rather than by PatchDiff so the diff carries a content cache
  // key: remounts (scroll-back, collapse/expand) then reuse the worker pool's
  // highlight instead of re-tokenizing. Anything other than exactly one file
  // falls through to PatchDiff, which keeps its own error behavior.
  const fileDiff = useMemo(() => {
    const parsed = parsePatchFiles(patch, pierreCacheKey(`diff:${path}`, patch));
    return parsed.length === 1 && parsed[0].files.length === 1 ? parsed[0].files[0] : null;
  }, [patch, path]);

  const options = useMemo<DiffOptions>(
    () => ({
      theme: PIERRE_THEME_PAIR,
      themeType: resolvedMode,
      disableFileHeader: true,
      diffStyle: 'unified',
      overflow: 'scroll',
    }),
    [resolvedMode],
  );

  const handleOpenFile = () => {
    if (!activeWorkspace) return;
    openFilePreview({
      workspaceId: activeWorkspace.id,
      ...toWorkspaceFileTarget(path, activeWorkspace),
      name: pathBasename(path),
    });
  };

  const counts = additions !== undefined && deletions !== undefined ? (
    <span className="flex shrink-0 items-center gap-1 tabular-nums" aria-label={`+${additions} -${deletions}`}>
      <span className="text-success">+{additions}</span>
      <span className="text-destructive">-{deletions}</span>
    </span>
  ) : null;

  return (
    <PreviewFrame
      totalLines={totalDiffLines}
      budget={RENDER_BUDGETS.diffPreviewLines}
      expanded={expanded}
      onToggle={setExpanded}
      caption={showPath && (
        <>
          <span className="min-w-0 truncate" title={path}>{path}</span>
          {counts}
        </>
      )}
      actions={!disablePathOpen && activeWorkspace && (
        <PreviewAction onClick={handleOpenFile} title={path}>Open file</PreviewAction>
      )}
    >
      {fileDiff ? (
        <FileDiff fileDiff={fileDiff} options={options} className="pierre-viz-host" />
      ) : (
        <PatchDiff patch={patch} options={options} className="pierre-viz-host" />
      )}
    </PreviewFrame>
  );
});
