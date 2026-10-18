import { type FC, memo, useState, useMemo, useCallback, type ComponentProps } from 'react';
import { Check, Copy } from 'lucide-react';
import { File as PierreFile } from '@pierre/diffs/react';
import type { SelectedLineRange } from '@pierre/diffs/react';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore, selectActiveWorkspace } from '@/stores/serverDataStore';
import { useTheme } from '@/components/providers/ThemeProvider';
import { pathBasename } from '@/lib/platform';
import { toWorkspaceFileTarget } from '@/lib/path';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';
import { PIERRE_THEME_PAIR, resolvePierreLang } from '@/lib/pierreDiffsTheme';
import { pierreCacheKey } from '@/lib/pierreCacheKey';
import { useVizExpanded } from '@/lib/vizExpansion';
import { PreviewAction, PreviewCornerButton, PreviewFrame } from './PreviewFrame';

type PierreFileOptions = ComponentProps<typeof PierreFile>['options'];

interface CodeBlockProps {
  content: string;
  path: string;
  language?: string;
  highlightLines?: number[];
  /** Name the file above the body; off when the tool row already does. */
  showPath?: boolean;
  /** Stable identity (tool-call part id) for persisted expansion state. */
  vizKey?: string;
}

/**
 * A written file as a peek: the first lines behind a fade, "Show all" to grow
 * it inline, "Open file" for the real editor. Created or overwrote is a chip
 * on the tool row, not a badge here.
 */
export const CodeBlock: FC<CodeBlockProps> = memo(({
  content,
  path,
  language,
  highlightLines = [],
  showPath = false,
  vizKey,
}) => {
  const [expanded, setExpanded] = useVizExpanded(
    vizKey ? `code:${vizKey}` : `code:${path}:${content.length}`,
    false,
  );
  const [copied, setCopied] = useState(false);
  const openFilePreview = useUIStore((s) => s.openFilePreview);
  const activeWorkspace = useServerDataStore(selectActiveWorkspace);

  const { resolvedMode } = useTheme();

  const handleOpenFile = () => {
    if (!activeWorkspace) return;
    openFilePreview({
      workspaceId: activeWorkspace.id,
      ...toWorkspaceFileTarget(path, activeWorkspace),
      name: pathBasename(path),
    });
  };

  const lineCount = useMemo(() => content.split('\n').length, [content]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const previewContent = useMemo(() => {
    if (expanded) return content;
    const lines = content.split('\n', RENDER_BUDGETS.codePreviewLines);
    return lines.join('\n');
  }, [content, expanded]);

  const name = pathBasename(path);
  const lang = useMemo(() => resolvePierreLang(name, language), [name, language]);

  const file = useMemo(
    () => ({
      name,
      contents: previewContent,
      lang,
      cacheKey: pierreCacheKey(`code:${name}:${lang ?? ''}`, previewContent),
    }),
    [name, previewContent, lang],
  );

  const options = useMemo<PierreFileOptions>(
    () => ({
      theme: PIERRE_THEME_PAIR,
      themeType: resolvedMode,
      disableFileHeader: true,
      overflow: 'scroll',
    }),
    [resolvedMode],
  );

  // Write-tool highlight tint. highlightLines is 1-based; Pierre's selection
  // is a single { start, end } range, so contiguous line sets (the common
  // case for a written block) map exactly and sparse sets tint the gap.
  // Clamped to the preview length so the folded peek never selects past the
  // rendered slice.
  const selectedLines = useMemo<SelectedLineRange | null>(() => {
    if (highlightLines.length === 0) return null;
    const previewLineCount = previewContent.split('\n').length;
    const start = Math.min(Math.max(1, Math.min(...highlightLines)), previewLineCount);
    const end = Math.min(Math.max(1, Math.max(...highlightLines)), previewLineCount);
    return { start, end };
  }, [highlightLines, previewContent]);

  return (
    <PreviewFrame
      totalLines={lineCount}
      budget={RENDER_BUDGETS.codePreviewLines}
      expanded={expanded}
      onToggle={setExpanded}
      caption={showPath && <span className="truncate" title={path}>{path}</span>}
      corner={(
        <>
          <span className="select-none pl-1 font-mono text-2xs text-muted-foreground/70">{lang ?? 'text'}</span>
          <PreviewCornerButton onClick={handleCopy} label="Copy code">
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </PreviewCornerButton>
        </>
      )}
      actions={activeWorkspace && (
        <PreviewAction onClick={handleOpenFile} title={path}>Open file</PreviewAction>
      )}
    >
      <PierreFile
        file={file}
        options={options}
        selectedLines={selectedLines}
        className="pierre-viz-host"
      />
    </PreviewFrame>
  );
});
