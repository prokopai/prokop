import type { ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The three states every panel can be in, so they look the same in settings,
 * docks and dialogs. Inline field errors stay `text-xs text-error`; lists
 * that know their row shape may use `Skeleton` while they load.
 */

interface LoadingStateProps {
  /** Shown beside the spinner; inline loading always has one. */
  label?: string;
  /** A line inside content instead of a centered block. */
  inline?: boolean;
  className?: string;
}

export function LoadingState({ label, inline = false, className }: LoadingStateProps) {
  if (inline) {
    return (
      <p role="status" className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        {label ?? 'Loading…'}
      </p>
    );
  }
  return (
    <div role="status" aria-label={label ?? 'Loading'} className={cn('animate-appear-late flex flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground', className)}>
      <Loader2 className="size-5 animate-spin" />
      {label}
    </div>
  );
}

interface ErrorStateProps {
  children: ReactNode;
  /** Offers a retry button in the box. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({ children, onRetry, retryLabel = 'Retry', className }: ErrorStateProps) {
  return (
    <Alert variant="error" className={className}>
      <AlertCircle />
      <AlertDescription className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 break-words">{children}</span>
        {onRetry && (
          <Button variant="outline" size="xs" onClick={onRetry} className="ml-auto shrink-0">
            {retryLabel}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

interface EmptyStateProps {
  children: ReactNode;
  /** A button or link under the sentence. */
  action?: ReactNode;
  /** `card` draws the dashed box used in settings; `plain` is for docks and lists. */
  variant?: 'card' | 'plain';
  className?: string;
}

export function EmptyState({ children, action, variant = 'card', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 px-3 py-8 text-center text-sm text-muted-foreground',
        variant === 'card' && 'rounded-lg border border-dashed',
        className,
      )}
    >
      <p className="max-w-prose">{children}</p>
      {action}
    </div>
  );
}
