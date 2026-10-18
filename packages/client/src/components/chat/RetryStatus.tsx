import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useChatRetryStore } from '@/stores/chatRetryStore';

interface RetryStatusProps {
  sessionId: string;
}

const ERROR_LABELS = {
  rate_limit: 'Provider rate limit',
  server_error: 'Provider error',
  timeout: 'Provider timeout',
  network: 'Network error',
} as const;

export function RetryStatus({ sessionId }: RetryStatusProps) {
  const retry = useChatRetryStore((state) => state.retryBySessionId[sessionId]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!retry?.retryAt) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [retry?.retryAt]);

  if (!retry) return null;

  const secondsRemaining = retry.retryAt && now > 0
    ? Math.max(0, Math.ceil((retry.retryAt - now) / 1_000))
    : null;
  const statusText = retry.status === 'scheduled' && secondsRemaining !== null
    ? `Retry ${retry.retryNumber} of ${retry.maxRetries} starts in ${secondsRemaining}s`
    : `Retry ${retry.retryNumber} of ${retry.maxRetries} in progress`;

  return (
    <div className="flex items-center gap-2 border-t border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
      <RefreshCw className={`size-3.5 shrink-0 ${retry.status === 'started' ? 'animate-spin' : ''}`} />
      <span className="font-medium">{statusText}</span>
      <span className="truncate text-warning/80">
        {ERROR_LABELS[retry.errorType] ?? retry.errorType}: {retry.message}
      </span>
    </div>
  );
}
