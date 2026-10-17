import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConnectionStore } from '@/stores/connectionStore';

interface ReconnectStatusProps {
  authError: string | null;
  nextRetryIn: number;
  onRetry: () => void;
}

/**
 * Mount only while disconnected, keyed by server. A brief drop or a server
 * switch stays quiet for 1.5 s; a drop found on return to the foreground shows
 * at once, since the user is already looking at a stale screen.
 */
export function ReconnectStatus({ authError, nextRetryIn, onRetry }: ReconnectStatusProps) {
  const foregroundRecovery = useConnectionStore((state) => state.foregroundRecovery);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!settled && !foregroundRecovery) return null;

  return (
    <div className="absolute right-2 top-full z-40 mt-1 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
      <span role="status">
        {authError ?? (nextRetryIn > 0 ? `Reconnecting in ${nextRetryIn}s...` : 'Reconnecting...')}
      </span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Retry now
      </Button>
    </div>
  );
}
