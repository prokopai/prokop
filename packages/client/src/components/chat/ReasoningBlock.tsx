import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatElapsed } from '@/lib/turnStats';
import { useVizExpanded } from '@/lib/vizExpansion';
import { cn } from '@/lib/utils';

interface ReasoningBlockProps {
  expansionKey: string;
  durationMs?: number;
  children: ReactNode;
}

/** Finished reasoning, folded to one line. Live reasoning renders unfolded elsewhere. */
export function ReasoningBlock({ expansionKey, durationMs, children }: ReasoningBlockProps) {
  const [open, setOpen] = useVizExpanded(expansionKey, false);

  return (
    <div className="my-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex items-center gap-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 shrink-0 opacity-60 transition-transform', open && 'rotate-90')} />
        <span>{durationMs !== undefined ? `Thought for ${formatElapsed(durationMs)}` : 'Thought'}</span>
      </button>
      {open && (
        <div className="visualization-container my-2 ml-1.5 border-l border-border/50 pl-3 text-sm text-muted-foreground wrap-break-word">
          {children}
        </div>
      )}
    </div>
  );
}
