import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PreviewFrameProps {
  /** Lines in the full content. */
  totalLines: number;
  /** Lines the body shows while folded. */
  budget: number;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  /** Slim line above the body for places where no tool row names the file. */
  caption?: ReactNode;
  /** Top-right overlay, shown on hover (always on touch). */
  corner?: ReactNode;
  /** Extra actions beside the show-all toggle. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * The one frame for tool previews: a quiet gray body that never scrolls on
 * its own. A long result shows its first (or last) lines behind a fade and a
 * single "Show all" action; opening it fully grows the transcript instead of
 * nesting a scroller inside it.
 */
export function PreviewFrame({ totalLines, budget, expanded, onToggle, caption, corner, actions, children }: PreviewFrameProps) {
  const truncated = !expanded && totalLines > budget;
  const canFold = expanded && totalLines > budget;

  return (
    <div className="visualization-container tool-preview min-w-0 max-w-full">
      {caption && (
        <div className="flex min-w-0 items-center gap-2 px-2.5 pb-1 font-mono text-2xs text-muted-foreground/70">
          {caption}
        </div>
      )}
      <div className="group/peek relative overflow-hidden rounded-lg bg-muted/40">
        {corner && (
          <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded-md bg-card/90 px-1 opacity-0 transition-opacity group-hover/peek:opacity-100 group-focus-within/peek:opacity-100 pointer-coarse:opacity-100">
            {corner}
          </div>
        )}
        {children}
        {truncated && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-card" />
        )}
      </div>
      {(truncated || canFold || actions) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 pt-1 text-2xs text-muted-foreground">
          {truncated && (
            <PreviewAction onClick={() => onToggle(true)}>Show all {totalLines} lines</PreviewAction>
          )}
          {canFold && (
            <PreviewAction onClick={() => onToggle(false)}>Show less</PreviewAction>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}

export function PreviewAction({ onClick, title, className, children }: {
  onClick: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn('rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring', className)}
    >
      {children}
    </button>
  );
}

/** Small icon button for the hover corner of a preview. */
export function PreviewCornerButton({ onClick, label, children }: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex items-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}
