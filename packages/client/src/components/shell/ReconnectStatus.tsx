import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConnectionStore } from '@/stores/connectionStore';

export const RECONNECT_TOAST_ID = 'reconnect-status';

interface ReconnectStatusProps {
  authError: string | null;
  nextRetryIn: number;
  onRetry: () => void;
}

/**
 * Mount only while disconnected, keyed by server. A brief drop or a server
 * switch stays quiet for 1.5 s; a drop found on return to the foreground shows
 * at once, since the user is already looking at a stale screen. The status is
 * a persistent toast that cannot be closed, only retried; it leaves with the
 * component once the connection is back.
 */
export function ReconnectStatus({ authError, nextRetryIn, onRetry }: ReconnectStatusProps) {
  const foregroundRecovery = useConnectionStore((state) => state.foregroundRecovery);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  const visible = settled || foregroundRecovery;
  const message = authError ?? (nextRetryIn > 0 ? `Reconnecting in ${nextRetryIn}s...` : 'Reconnecting...');

  useEffect(() => {
    if (!visible) return;
    toast(message, {
      id: RECONNECT_TOAST_ID,
      duration: Infinity,
      dismissible: false,
      action: {
        label: 'Retry now',
        onClick: (event) => {
          event.preventDefault();
          onRetry();
        },
      },
    });
  }, [visible, message, onRetry]);

  useEffect(() => () => {
    toast.dismiss(RECONNECT_TOAST_ID);
  }, []);

  return null;
}
