import { memo, useState } from 'react';
import { Bot, ChevronRight, Clock, CornerDownRight, SquareTerminal, X } from 'lucide-react';
import type { HostEvent } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatUserText, UserPromptText } from './UserPromptText';

/** Bodies longer than this start collapsed; a shell note is short, a task result can be a page. */
const COLLAPSE_AT = 400;

const OUTCOME_WORD: Record<HostEvent['outcome'], string> = {
  ok: 'finished',
  error: 'failed',
  ask: 'needs an answer',
  stopped: 'stopped',
};

interface HostEventRowProps {
  event: HostEvent;
  /** The note after the header: terminal chips and the text the model read. */
  body: string;
  sessionId: string;
  /** Queued behind a running turn, or marked to enter it. */
  queued?: 'pending' | 'steering';
  onRemove?: () => void;
  onNavigateToSubagent?: (sessionId: string) => void;
}

/**
 * A note the host delivered to the session, rendered as an event instead of
 * a prompt: a background command finished, a delegated task finished or waits
 * on a question. Full width and muted, so it does not read as something the
 * person typed. The label of a task opens the child session.
 */
export const HostEventRow = memo(function HostEventRow({ event, body, sessionId, queued, onRemove, onNavigateToSubagent }: HostEventRowProps) {
  const trimmed = body.trim();
  const long = trimmed.length > COLLAPSE_AT;
  const [open, setOpen] = useState(!long);
  const Icon = event.kind === 'shell' ? SquareTerminal : Bot;
  const openChild = event.kind === 'task' && onNavigateToSubagent ? () => onNavigateToSubagent(event.id) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm" role="status" data-host-event={event.kind}>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {queued && (
          <>
            {queued === 'steering' ? <CornerDownRight className="size-3 animate-pulse" /> : <Clock className="size-3 animate-pulse" />}
            <span>{queued === 'steering' ? 'Steering' : 'Pending'}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <Icon className="size-3.5 shrink-0" />
        {openChild ? (
          <button
            type="button"
            onClick={openChild}
            className="min-w-0 truncate font-medium text-foreground hover:underline"
            title="Open the task's session"
          >
            {event.label}
          </button>
        ) : (
          <span className={cn('min-w-0 truncate text-foreground', event.kind === 'shell' && 'font-mono')} title={event.label}>
            {event.label}
          </span>
        )}
        <span className={cn('shrink-0', event.outcome === 'error' && 'text-destructive')}>{OUTCOME_WORD[event.outcome]}</span>
        {event.meta && <span className="min-w-0 truncate" title={event.meta}>· {event.meta}</span>}
        {long && (
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            aria-expanded={open}
            className="flex shrink-0 items-center gap-0.5 hover:text-foreground"
          >
            <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
            {open ? 'Hide' : 'Show'}
          </button>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="ml-auto size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Remove from queue"
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
      {open && trimmed && (
        <div className="min-w-0 pl-5.5 text-muted-foreground">
          <UserPromptText text={trimmed} sessionId={sessionId} formatBody={formatUserText} />
        </div>
      )}
    </div>
  );
});
