import { Copy, Check, X, Clock, CornerDownRight, Undo2, GitBranch, Pin, PinOff, Pencil, Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { Message } from '@prokopai/sdk';
import { contextMessagePlainText, isAssistantMessage, joinContextEnvelope, splitContextEnvelope } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { getTurnMeta } from '@/lib/turnStats';
import type { PendingSendStatus } from '@/stores/pendingSendStore';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: Message;
  textContent?: string;
  children?: React.ReactNode;
  isQueued?: boolean;
  onRemove?: () => void;
  /** Marked to enter the running turn at its next safe point. */
  isSteering?: boolean;
  onSteer?: () => void;
  onRevert?: () => void;
  canRevert?: boolean;
  onFork?: () => void;
  canFork?: boolean;
  forkUnavailableReason?: string;
  onEdit?: (content: string) => void;
  canEdit?: boolean;
  isClearAll?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  canPin?: boolean;
  isPinningMessage?: boolean;
  /** Set for a prompt shown before the server persisted it. */
  sendStatus?: PendingSendStatus;
  sendError?: string;
  onRetrySend?: () => void;
  onEditSend?: () => void;
  onDiscardSend?: () => void;
}

/**
 * Under an unconfirmed prompt. "Sending" fades in only after a short delay,
 * so a normal round trip shows nothing; a failure always shows with its
 * actions, never only on hover.
 */
function SendStatus({ status, error, onRetry, onEdit, onDiscard }: {
  status: PendingSendStatus;
  error?: string;
  onRetry?: () => void;
  onEdit?: () => void;
  onDiscard?: () => void;
}) {
  if (status === 'sending') {
    return (
      <div className="mr-1 flex items-center gap-1 text-2xs text-muted-foreground/70 animate-in fade-in-0 [--tw-animation-delay:700ms] [--tw-animation-fill-mode:both]">
        <Loader2 className="size-3 animate-spin" />
        Sending
      </div>
    );
  }
  if (status !== 'failed') return null;
  return (
    <div role="alert" className="mr-1 flex max-w-[90%] flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-xs text-error">
      <span className="flex min-w-0 items-center gap-1">
        <AlertCircle className="size-3 shrink-0" />
        <span className="truncate" title={error}>Not sent{error ? `: ${error}` : ''}</span>
      </span>
      <span className="flex items-center gap-1">
        {onRetry && (
          <Button variant="ghost" size="xs" className="h-5 px-1.5 text-xs" onClick={onRetry}>
            <RotateCcw className="size-3" data-icon="inline-start" />
            Retry
          </Button>
        )}
        {onEdit && (
          <Button variant="ghost" size="xs" className="h-5 px-1.5 text-xs" onClick={onEdit}>
            <Pencil className="size-3" data-icon="inline-start" />
            Edit
          </Button>
        )}
        {onDiscard && (
          <Button variant="ghost" size="xs" className="h-5 px-1.5 text-xs text-muted-foreground" onClick={onDiscard}>
            Discard
          </Button>
        )}
      </span>
    </div>
  );
}

export function MessageBubble({
  message,
  textContent,
  children,
  isQueued = false,
  onRemove,
  isSteering = false,
  onSteer,
  onRevert,
  canRevert = false,
  onFork,
  canFork = false,
  forkUnavailableReason,
  onEdit,
  canEdit = false,
  isClearAll = false,
  isPinned = false,
  onTogglePin,
  canPin = false,
  isPinningMessage = false,
  sendStatus,
  sendError,
  onRetrySend,
  onEditSend,
  onDiscardSend,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const [showForkConfirm, setShowForkConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === 'user';

  const sessionId = message.sessionId;
  const isForking = usePendingOperationsStore((s) =>
    s.operations.some((op) => op.sessionId === sessionId && op.type === 'fork' && op.messageId === message.id),
  );
  const isReverting = usePendingOperationsStore((s) =>
    s.operations.some((op) => op.sessionId === sessionId && op.type === 'revert' && op.messageId === message.id),
  );
  const isEditingPending = usePendingOperationsStore((s) =>
    s.operations.some((op) => op.sessionId === sessionId && op.type === 'edit' && op.messageId === message.id),
  );

  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.setSelectionRange(
        editTextareaRef.current.value.length,
        editTextareaRef.current.value.length,
      );
      const textarea = editTextareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 250)}px`;
    }
  }, [isEditing]);

  const handleCopy = async () => {
    // User prompts copy as people would type them, with captured terminal output inline.
    const text = isUser ? contextMessagePlainText(textContent || '', { terminals: 'fenced' }) : textContent || '';
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartEdit = () => {
    // The envelope stays out of the edit box and returns on save for references still present.
    setEditText(splitContextEnvelope(textContent || '').body);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditText('');
  };

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (!trimmed || !onEdit) return;
    onEdit(joinContextEnvelope(trimmed, splitContextEnvelope(textContent || '').terminals.values()));
  };

  useEffect(() => {
    if (isEditingPending) {
      setIsEditing(false);
    }
  }, [isEditingPending]);

  const handleEditKeydown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleEditTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 250)}px`;
  };

  const showPinButton = canPin && onTogglePin && !isQueued;
  const showEditButton = canEdit && onEdit && !isQueued && isUser;
  const forkDisabled = Boolean(forkUnavailableReason);
  const showAssistantFork = message.role === 'assistant' && canFork && (Boolean(onFork) || forkDisabled);
  const hoverActionClass = 'opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100';
  const turnMeta = isAssistantMessage(message) ? getTurnMeta(message) : null;
  const turnMetaParts = turnMeta
    ? [
      turnMeta.model && { key: 'model', label: turnMeta.model },
      turnMeta.duration && { key: 'duration', label: turnMeta.duration },
      turnMeta.tokens && { key: 'tokens', label: turnMeta.tokens, title: turnMeta.tokensTitle },
    ].filter((part): part is { key: string; label: string; title?: string } => Boolean(part))
    : [];

  const renderAssistantActions = () => (
    <>
      {showAssistantFork && (
        <span title={forkDisabled ? forkUnavailableReason : undefined}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowForkConfirm(true)}
            disabled={isForking || forkDisabled}
            className={cn('size-5 text-muted-foreground hover:text-foreground', hoverActionClass)}
            title={forkDisabled ? undefined : 'Fork from this response'}
          >
            {isForking ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <GitBranch className="size-3" />
            )}
          </Button>
        </span>
      )}
      {showPinButton && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onTogglePin}
          disabled={isPinningMessage}
          className={cn('size-5', isPinned
            ? 'text-highlight hover:text-highlight/80'
            : 'text-muted-foreground hover:text-foreground',
          !isPinned && hoverActionClass)}
          title={isPinned ? 'Unpin message' : 'Pin message'}
        >
          {isPinningMessage ? <Loader2 className="size-3 animate-spin" />
            : isPinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        className={cn('size-5 text-muted-foreground hover:text-foreground', hoverActionClass)}
        title="Copy response"
      >
        {copied ? (
          <Check className="size-3" />
        ) : (
          <Copy className="size-3" />
        )}
      </Button>
    </>
  );

  // No role labels: a right-aligned tinted bubble is the user, full-width text
  // is the assistant. Actions and turn meta sit under the message and appear
  // on hover (always on touch).
  const showUserActions = isUser && !isQueued && !isEditing && !isEditingPending;

  return (
    <div
      className={cn(
        'group/msg flex flex-col gap-1 min-w-0',
        isUser ? 'items-end' : 'items-stretch'
      )}
    >
      {isEditing && isUser ? (
        <div className="w-full max-w-[90%] self-end">
          <Textarea
            ref={editTextareaRef}
            value={editText}
            onChange={handleEditTextChange}
            onKeyDown={handleEditKeydown}
            aria-label="Edit message"
            className="rounded-2xl rounded-br-md bg-highlight/10 text-foreground resize-none min-h-[60px] border-transparent focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-highlight/40"
          />
          <div className="flex items-center justify-end gap-1 mt-1.5">
            <Button
              variant="ghost"
              onClick={handleCancelEdit}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={!editText.trim()}
              className="h-7 text-xs"
            >
              Send
            </Button>
          </div>
        </div>
      ) : isEditingPending ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground self-end mr-3 animate-fade-in">
          <Loader2 className="size-3 animate-spin" />
          Applying edit...
        </div>
      ) : (
        <div
          className={cn(
            'relative group min-w-0 overflow-hidden',
            isUser
              ? isQueued
                // Not sent yet: a lighter fill than a sent message, plus the Pending or Steering header. No outline.
                ? 'on-muted-surface rounded-2xl rounded-br-md px-3.5 py-2.5 max-w-[85%] bg-highlight/10 text-foreground'
                : 'on-muted-surface rounded-2xl rounded-br-md px-3.5 py-2.5 max-w-[85%] bg-highlight/15 text-foreground'
              : 'w-full overflow-visible'
          )}
        >
          {isQueued && (
            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-border/50">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isSteering ? <CornerDownRight className="size-3 animate-pulse" /> : <Clock className="size-3 animate-pulse" />}
                <span>{isSteering ? 'Steering' : 'Pending'}</span>
              </div>
              <div className="flex items-center gap-1">
                {onSteer && (
                  <Button
                    variant="ghost"
                    onClick={onSteer}
                    className="h-6 px-2 text-xs text-muted-foreground"
                    title="Send into the running turn at its next step"
                  >
                    Steer
                  </Button>
                )}
                {onRemove && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRemove}
                    className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Remove from queue"
                  >
                    <X className="size-3" />
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="min-w-0">
            {children}
          </div>
        </div>
      )}

      {isUser && sendStatus && (
        <SendStatus
          status={sendStatus}
          error={sendError}
          onRetry={onRetrySend}
          onEdit={onEditSend}
          onDiscard={onDiscardSend}
        />
      )}

      {showUserActions && (
        <div className={cn('mr-1 flex items-center gap-0.5', hoverActionClass)}>
          {canRevert && onRevert && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowRevertConfirm(true)}
              className="size-5 text-muted-foreground hover:text-foreground"
              title="Revert to this point"
            >
              <Undo2 className="size-3" />
            </Button>
          )}
          {canFork && (onFork || forkDisabled) && (
            <span title={forkDisabled ? forkUnavailableReason : undefined}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowForkConfirm(true)}
                disabled={forkDisabled}
                className="size-5 text-muted-foreground hover:text-foreground"
                title={forkDisabled ? undefined : 'Fork from this point'}
              >
                <GitBranch className="size-3" />
              </Button>
            </span>
          )}
          {showEditButton && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleStartEdit}
              className="size-5 text-muted-foreground hover:text-foreground"
              title="Edit and resubmit"
            >
              <Pencil className="size-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            className="size-5 text-muted-foreground hover:text-foreground"
            title="Copy message"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </Button>
        </div>
      )}

      {(showAssistantFork || turnMetaParts.length > 0) && (
        <div className="ml-1 flex min-w-0 items-center gap-0.5">
          {showAssistantFork && renderAssistantActions()}
          {turnMetaParts.length > 0 && (
            <span
              className={cn('flex min-w-0 items-center gap-1 pl-1 text-2xs text-muted-foreground/70', hoverActionClass)}
              data-testid="turn-meta"
            >
              {turnMetaParts.map(({ key, label, title }, index) => (
                <span key={key} className="truncate tabular-nums" title={title}>
                  {index > 0 && '· '}{label}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <ConfirmationDialog
        open={showRevertConfirm || isReverting}
        onOpenChange={(open) => { if (!isReverting) setShowRevertConfirm(open); }}
        title={isClearAll ? 'Clear Conversation' : 'Revert Conversation'}
        description={
          isClearAll
            ? 'This will delete all messages in this session, leaving it completely empty. Are you sure you want to continue?'
            : 'This will delete this message and all messages after it. Are you sure you want to continue?'
        }
        confirmLabel={isClearAll ? 'Clear All' : 'Revert'}
        cancelLabel="Cancel"
        onConfirm={() => {
          onRevert?.();
        }}
        variant="destructive"
        loading={isReverting}
      />

      <ConfirmationDialog
        open={showForkConfirm || isForking}
        onOpenChange={(open) => { if (!isForking) setShowForkConfirm(open); }}
        title={isUser ? 'Fork Conversation' : 'Fork from this response?'}
        description={
          isUser
            ? 'This will create a new session with messages up to and including this point. The original session will be unchanged.'
            : 'Create a new session that includes this response and everything before it. The original session will remain unchanged.'
        }
        confirmLabel={isUser ? 'Fork' : 'Create fork'}
        cancelLabel="Cancel"
        onConfirm={() => {
          onFork?.();
        }}
        loading={isForking}
      />
    </div>
  );
}
