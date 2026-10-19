import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface DisclosureRowProps {
  label: string;
  /** Value recap shown right-aligned on the trigger; a null summary keeps the row collapsed. */
  summary: string | null;
  /** Kept for callers; every disclosure is a settings row now. */
  bordered?: boolean;
  /** Defaults to open when a summary exists. */
  defaultOpen?: boolean;
  /** Indents the trigger like the rows it sits among when nested. */
  className?: string;
  children: ReactNode;
}

/**
 * A settings row that opens into more rows: the label left, the recap and a
 * chevron right. Children are rows, separated by the same hairlines.
 */
export function DisclosureRow({ label, summary, defaultOpen = summary !== null, className, children }: DisclosureRowProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="flex flex-col divide-y divide-border/50">
      <CollapsibleTrigger
        className={cn(
          'group/disclosure flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {summary && <span className="min-w-0 shrink truncate text-xs text-muted-foreground" title={summary}>{summary}</span>}
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/disclosure:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col divide-y divide-border/50">{children}</CollapsibleContent>
    </Collapsible>
  );
}
