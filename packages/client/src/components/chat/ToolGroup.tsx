import type { ReactNode } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { Part } from '@prokopai/sdk';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatDuration } from '@/lib/turnStats';
import { getToolGroupStats } from '@/lib/turnParts';
import { useVizExpandedOverride } from '@/lib/vizExpansion';
import { cn } from '@/lib/utils';

interface ToolGroupProps {
  expansionKey: string;
  parts: Part[];
  /** The run is the streaming message's tail: the agent is still working in it. */
  live: boolean;
  children: ReactNode;
}

/**
 * One row for a run of tool calls. Open while the agent works in it, folded
 * once it finishes, unless the user has toggled it. Success is silent: only a
 * running group spins and only failures take color.
 */
export function ToolGroup({ expansionKey, parts, live, children }: ToolGroupProps) {
  const stats = getToolGroupStats(parts);
  const [open, setOpen] = useVizExpandedOverride(expansionKey, stats.active || live);
  const names = stats.names
    .map(({ name, count }) => (count > 1 ? `${name} ×${count}` : name))
    .join(' · ');
  const countLabel = `${stats.toolCount} tool ${stats.toolCount === 1 ? 'call' : 'calls'}`;

  return (
    <div className="my-1">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={`${countLabel}: ${names}`}
            title={countLabel}
            className="flex w-full items-center gap-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {stats.active
              ? <Loader2 className="size-3 shrink-0 animate-spin" />
              : <ChevronRight className={cn('size-3 shrink-0 opacity-60 transition-transform', open && 'rotate-90')} />}
            <span className="min-w-0 flex-1 truncate font-mono">{names}</span>
            {stats.failedCount > 0 && (
              <span className="shrink-0 text-2xs text-destructive">
                {stats.failedCount} failed
              </span>
            )}
            {(stats.additions > 0 || stats.deletions > 0) && (
              <span className="hidden shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/70 sm:inline">
                {stats.additions > 0 && `+${stats.additions}`}
                {stats.additions > 0 && stats.deletions > 0 && ' '}
                {stats.deletions > 0 && `−${stats.deletions}`}
              </span>
            )}
            {stats.durationMs !== undefined && (
              <span className="hidden shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/70 sm:inline">
                {formatDuration(stats.durationMs)}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        {open && (
          <CollapsibleContent>
            <div className="ml-1.5 border-l border-border/50 pl-3">
              {children}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}
