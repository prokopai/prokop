import type { AssistantMessage } from '@prokopai/sdk';
import { AlertTriangle, Clock, Key, Server, ShieldAlert } from 'lucide-react';

type ErrorType =
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'authentication'
  | 'context_overflow'
  | 'invalid_request'
  | 'unknown';

interface ErrorMeta {
  label: string;
  description: string;
  icon: React.ReactNode;
}

const ERROR_META: Record<ErrorType, ErrorMeta> = {
  rate_limit: {
    label: 'Rate limited',
    description: 'Too many requests. Please wait a moment and try again.',
    icon: <Clock className="size-3.5" />,
  },
  server_error: {
    label: 'Server error',
    description: 'The AI provider encountered an error. Please try again.',
    icon: <Server className="size-3.5" />,
  },
  timeout: {
    label: 'Request timed out',
    description: 'The request took too long. Please try again.',
    icon: <Clock className="size-3.5" />,
  },
  authentication: {
    label: 'Authentication failed',
    description: 'Check your API key configuration.',
    icon: <Key className="size-3.5" />,
  },
  context_overflow: {
    label: 'Context overflow',
    description: 'The conversation is too long. Try compacting or starting a new session.',
    icon: <AlertTriangle className="size-3.5" />,
  },
  invalid_request: {
    label: 'Invalid request',
    description: 'The request was rejected by the provider.',
    icon: <ShieldAlert className="size-3.5" />,
  },
  unknown: {
    label: 'Error',
    description: 'An unexpected error occurred.',
    icon: <AlertTriangle className="size-3.5" />,
  },
};

function classifyError(error?: string): ErrorType {
  if (!error) return 'unknown';
  const lower = error.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('429')) return 'rate_limit';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('auth') || lower.includes('api key') || lower.includes('401') || lower.includes('403')) return 'authentication';
  if (lower.includes('context') || lower.includes('overflow') || lower.includes('too long') || lower.includes('token limit')) return 'context_overflow';
  if (lower.includes('invalid request') || lower.includes('400')) return 'invalid_request';
  if (lower.includes('server error') || lower.includes('500') || lower.includes('502') || lower.includes('503')) return 'server_error';
  return 'unknown';
}

interface ErrorMessageContentProps {
  message: AssistantMessage;
}

/** A failed turn: one quiet destructive box, label in sentence case. */
export function ErrorMessageContent({ message }: ErrorMessageContentProps) {
  const errorType = classifyError(message.error);
  const meta = ERROR_META[errorType];

  return (
    <div role="alert" className="flex min-w-0 items-start gap-2 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-sm">
      <span className="mt-0.5 shrink-0 text-error">{meta.icon}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-error">{meta.label}</span>
        <p className="break-words text-error/90">{message.error || meta.description}</p>
        {message.error && message.error !== meta.description && (
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        )}
      </div>
    </div>
  );
}
