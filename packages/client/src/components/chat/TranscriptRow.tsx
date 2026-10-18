import { useState, memo } from 'react';
import type { ReactNode } from 'react';
import { buildApiUrl } from '@/config/urls';
import { AlertTriangle, ChevronRight, Download, FileIcon, RotateCcw } from 'lucide-react';
import type { Part, TextPart, Message, CompactionPart, AssistantMessage, StructuredOutputData } from '@prokopai/sdk';
import { isAssistantMessage } from '@prokopai/sdk';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { MessageBubble } from './MessageBubble';
import { UserPromptText } from './UserPromptText';
import { ErrorMessageContent } from './ErrorMessageContent';
import { ToolCall } from './ToolCall';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { StructuredResponse } from '@/components/visualizations';
import { estimateReasoningMs, groupTurnParts } from '@/lib/turnParts';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolGroup } from './ToolGroup';


import type { DisplayItem, PendingSendActions } from './VirtualizedTranscript';
import { StreamingReasoning, StreamingText } from './StreamingMessageText';

function getTextContent(parts: Part[]): string {
  return parts
    .filter((part): part is TextPart => part.type === 'text')
    .map(part => part.text)
    .join('');
}

/**
 * Double single newlines for markdown line breaks in user messages,
 * but preserve original formatting inside fenced code blocks.
 */
function formatUserText(text: string): string {
  const segments = text.split(/```/);
  return segments
    .map((segment, i) => {
      if (i % 2 === 1) {
        // Inside a fenced code block — preserve as-is, re-add fences
        return '```' + segment + '```';
      }
      // Outside code blocks — double single newlines for markdown rendering
      return segment.replace(/\n(?!\n)/g, '\n\n');
    })
    .join('');
}

/** Hairline divider with a short status, the same shape as harness-switch markers. */
export function TranscriptDivider({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground" role="status">
      <span className="h-px w-8 bg-border" />
      {icon}
      {children}
      <span className="h-px w-8 bg-border" />
    </div>
  );
}

function CompactionFailedMessage({
  message,
  textContent,
  onRetry,
}: {
  message: AssistantMessage;
  textContent: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex min-w-0 items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-destructive">Compaction failed</span>
        <p className="break-words text-destructive/90">
          {textContent || message.error || 'The conversation could not be summarized.'}
        </p>
        {onRetry && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onRetry}
            className="mt-1 self-start text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" data-icon="inline-start" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function getFileExtensionBadge(mimeType?: string, filename?: string): string {
  const ext = mimeType?.split('/').pop() || filename?.split('.').pop()?.toLowerCase() || '';
  return ext;
}

function CompactionDivider({ part }: { part: CompactionPart }) {
  const [expanded, setExpanded] = useState(false);

  const reason = part.overflow ? 'overflow' : part.auto ? 'auto' : 'manual';

  return (
    <div className="flex flex-col items-center py-3">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="h-px w-8 bg-border" />
        <ChevronRight className={cn('size-3 opacity-60 transition-transform', expanded && 'rotate-90')} />
        <span>
          {reason === 'overflow' ? 'Context overflow' : reason === 'auto' ? 'Auto' : 'Manual'} compaction
        </span>
        <span className="h-px w-8 bg-border" />
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-muted-foreground">
          Summary available in the assistant message below
        </div>
      )}
    </div>
  );
}

// Parts that have streamed in this app session keep the streaming render path
// after completion, so the finished message never remounts into a different
// tree (which would pop the already-visible text).
const STREAMED_PART_IDS = new Set<string>();

const MessageParts = memo(function MessageParts({
  collapseToolPreviews = false,
  sessionId,
  parts,
  onNavigateToSubagent,
  userPrompt = false,
  isStreaming = false,
  serverUrl,
}: {
  sessionId: string;
  parts: Part[];
  onNavigateToSubagent?: (sessionId: string) => void;
  /** Text parts of a sent user message: context references render as chips, single newlines break lines. */
  userPrompt?: boolean;
  isStreaming?: boolean;
  serverUrl?: string;
  collapseToolPreviews?: boolean;
}) {
  const renderPart = (part: Part, index: number): ReactNode => {
    // Parts stream sequentially, so only the last part of a streaming
    // message animates; any part with a successor snaps to full text.
    const animate = isStreaming && index === parts.length - 1;
    switch (part.type) {
      case 'text': {
        if (userPrompt && part.text) {
          return (
            <div key={part.id} className="min-w-0">
              <UserPromptText text={part.text} sessionId={sessionId} formatBody={formatUserText} />
            </div>
          );
        }
        const text = userPrompt && part.text
          ? formatUserText(part.text)
          : (part.text || '...');
        if (isStreaming && !userPrompt) STREAMED_PART_IDS.add(part.id);
        const streamingPath = !userPrompt && (isStreaming || STREAMED_PART_IDS.has(part.id));
        return (
          <div key={part.id} className="min-w-0">
            {streamingPath ? (
              <StreamingText text={text} active={animate} />
            ) : (
              <MarkdownRenderer>{text}</MarkdownRenderer>
            )}
          </div>
        );
      }

      case 'reasoning':
        if (!animate) {
          return (
            <ReasoningBlock
              key={part.id}
              expansionKey={`reasoning:${serverUrl ?? ''}:${sessionId}:${part.id}`}
              durationMs={estimateReasoningMs(parts, index)}
            >
              {part.text}
            </ReasoningBlock>
          );
        }
        return (
          <div
            key={part.id}
            className="visualization-container my-2 ml-1.5 border-l border-border/50 pl-3 text-sm text-muted-foreground wrap-break-word"
          >
            <StreamingReasoning text={part.text} active={animate} />
          </div>
        );

      case 'tool':
        return (
          <ToolCall
            key={part.id}
            sessionId={sessionId}
            part={part}
            collapsePreview={collapseToolPreviews && part.state.status === 'completed'}
            onNavigateToSubagent={onNavigateToSubagent}
          />
        );

      case 'image': {
        const fullUrl = serverUrl ? buildApiUrl(serverUrl, part.url) : part.url;
        return (
          <img
            key={part.id}
            src={fullUrl}
            alt=""
            className="max-w-full max-h-64 rounded-xl mt-2 object-contain"
          />
        );
      }

      case 'file': {
        const fullUrl = serverUrl ? buildApiUrl(serverUrl, part.url) : part.url;
        const ext = getFileExtensionBadge(part.mimeType, part.filename);
        const filename = part.filename || '';
        const displayName = filename.length > 30
          ? filename.slice(0, 27) + '...'
          : (filename || 'unnamed');
        return (
          <a
            key={part.id}
            href={fullUrl}
            className="mt-2 flex items-center gap-2 rounded-lg border border-border/50 bg-card p-2 text-sm transition-colors hover:bg-accent"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{displayName}</span>
            {ext && (
              <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground/70">
                {ext}
              </span>
            )}
            <Download className="size-3.5 shrink-0 text-muted-foreground/70" />
          </a>
        );
      }

      default:
        return null;
    }
  };

  if (userPrompt) return <>{parts.map(renderPart)}</>;

  return (
    <>
      {groupTurnParts(parts).map(segment => segment.kind === 'part'
        ? renderPart(segment.part, segment.index)
        : (
          <ToolGroup
            key={`group:${segment.id}`}
            expansionKey={`tools:${serverUrl ?? ''}:${sessionId}:${segment.id}`}
            parts={segment.items.map(item => item.part)}
            live={isStreaming && segment.items[segment.items.length - 1].index === parts.length - 1}
          >
            {segment.items.map(item => renderPart(item.part, item.index))}
          </ToolGroup>
        ))}
    </>
  );
}, (prev, next) => {
  if (prev.sessionId !== next.sessionId) return false;
  if (prev.parts !== next.parts) return false;
  if (prev.collapseToolPreviews !== next.collapseToolPreviews) return false;
  if (prev.userPrompt !== next.userPrompt) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.onNavigateToSubagent !== next.onNavigateToSubagent) return false;
  if (prev.serverUrl !== next.serverUrl) return false;

  return true;
});

const StructuredOutputMessage = memo(function StructuredOutputMessage({
  collapseToolPreviews,
  sessionId,
  parts,
  structuredOutput,
  onNavigateToSubagent,
  serverUrl,
}: {
  sessionId: string;
  parts: Part[];
  structuredOutput: StructuredOutputData;
  collapseToolPreviews?: boolean;
  onNavigateToSubagent?: (sessionId: string) => void;
  serverUrl?: string;
}) {
  const [rawOpen, setRawOpen] = useState(false);

  return (
    <>
      <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex items-center gap-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className={cn('size-3 opacity-60 transition-transform', rawOpen && 'rotate-90')} />
            <span>
              Raw output
              {structuredOutput.formatName && (
                <span className="text-muted-foreground/70"> · {structuredOutput.formatName}</span>
              )}
            </span>
          </button>
        </CollapsibleTrigger>
        {rawOpen && (
          <CollapsibleContent>
            <div className="pb-2">
              <MessageParts
                sessionId={sessionId}
                parts={parts}
                onNavigateToSubagent={onNavigateToSubagent}
                collapseToolPreviews={collapseToolPreviews}
                serverUrl={serverUrl}
              />
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>

      <div className="mt-2">
        <StructuredResponse
          formatName={structuredOutput.formatName}
          data={structuredOutput.data}
          schema={structuredOutput.schema}
        />
      </div>
    </>
  );
});

interface MessageRowProps {
  item: DisplayItem;
  revertMessageId: string | null;
  sessionId: string;
  onNavigateToSubagent?: (sessionId: string) => void;
  onRemoveFromQueue?: (queueId: string) => void;
  onSteerQueued?: (queueId: string) => void;
  pendingSendActions?: PendingSendActions;
  onRevert?: (sessionId: string, stepPartId: string) => void;
  onFork?: (sessionId: string, messageId: string) => void;
  assistantOnlyFork?: boolean;
  forkUnavailableReason?: string;
  isMainActiveSession?: boolean;
  isCompacting?: boolean;
  onCompact?: () => void;
  onEditMessage?: (sessionId: string, messageId: string, content: string) => void;
  serverUrl?: string;
  isPinned?: boolean;
  canPin?: boolean;
  onTogglePinMessage?: (message: Message) => void;
  isPinningMessage?: boolean;
}

export const MessageRow = memo(function MessageRow({
  item,
  revertMessageId,
  sessionId,
  onNavigateToSubagent,
  onRemoveFromQueue,
  onSteerQueued,
  pendingSendActions,
  onRevert,
  onFork,
  assistantOnlyFork = false,
  forkUnavailableReason,
  onEditMessage,
  isMainActiveSession = false,
  isCompacting = false,
  onCompact,
  serverUrl,
  isPinned = false,
  canPin = false,
  onTogglePinMessage,
  isPinningMessage = false,
}: MessageRowProps) {
  const compactionPart = item.parts.find(
    (p): p is CompactionPart => p.type === 'compaction'
  );

  const isCompactFailed = isAssistantMessage(item.message) && item.message.mode === 'compact_failed';

  if (isCompactFailed) {
    return (
      <CompactionFailedMessage
        message={item.message as AssistantMessage}
        textContent={getTextContent(item.parts)}
        onRetry={isMainActiveSession && !isCompacting ? onCompact : undefined}
      />
    );
  }

  const isError = isAssistantMessage(item.message) && item.message.status === 'error';
  const hasContentParts = item.parts.some(p => p.type === 'text' || p.type === 'reasoning' || p.type === 'tool');

  if (isError && !hasContentParts) {
    return (
      <ErrorMessageContent
        message={item.message as AssistantMessage}
      />
    );
  }

  if (compactionPart) {
    return <CompactionDivider part={compactionPart} />;
  }

  const canRevert = !item.isQueued && item.message.role === 'user';
  const canFork = !item.isQueued && (
    (!assistantOnlyFork && item.message.role === 'user' && revertMessageId !== null) ||
    (isAssistantMessage(item.message) && item.message.status === 'completed')
  );
  const isClearAll = revertMessageId === item.message.id;
  const pending = item.pendingSend;

  return (
    <>
      <MessageBubble
        message={item.message}
        textContent={getTextContent(item.parts)}
        isQueued={item.isQueued}
        onRemove={item.isQueued && item.queueId && onRemoveFromQueue
          ? () => onRemoveFromQueue(item.queueId!) : undefined}
        isSteering={item.isQueued && item.isSteer}
        onSteer={item.isQueued && !item.isSteer && item.queueId && !item.pendingSend && onSteerQueued
          ? () => onSteerQueued(item.queueId!) : undefined}
        sendStatus={item.pendingSend?.status}
        sendError={item.pendingSend?.error}
        onRetrySend={pending && pendingSendActions?.retry ? () => pendingSendActions.retry?.(pending.id) : undefined}
        onEditSend={pending && pendingSendActions ? () => pendingSendActions.edit(pending.id) : undefined}
        onDiscardSend={pending && pendingSendActions ? () => pendingSendActions.discard(pending.id) : undefined}
        canRevert={canRevert && revertMessageId !== null}
        onRevert={revertMessageId && onRevert ? () => onRevert(sessionId, revertMessageId) : undefined}
        canFork={canFork}
        forkUnavailableReason={forkUnavailableReason}
        onFork={canFork && onFork ? () => onFork(sessionId, item.message.id) : undefined}
        canEdit={canRevert && !item.isQueued}
        onEdit={onEditMessage ? (content) => onEditMessage(sessionId, item.message.id, content) : undefined}
        isClearAll={isClearAll}
        isPinned={isPinned}
        canPin={canPin}
        onTogglePin={onTogglePinMessage ? () => onTogglePinMessage(item.message) : undefined}
        isPinningMessage={isPinningMessage}
      >
        {item.parts.length === 0 ? (
          <span className="opacity-50">...</span>
        ) : isAssistantMessage(item.message) && item.message.structuredOutput ? (
          <StructuredOutputMessage
            sessionId={sessionId}
            parts={item.parts}
            structuredOutput={item.message.structuredOutput}
            collapseToolPreviews={item.collapseToolPreviews}
            onNavigateToSubagent={onNavigateToSubagent}
            serverUrl={serverUrl}
          />
        ) : (
          <MessageParts
            sessionId={sessionId}
            parts={item.parts}
            onNavigateToSubagent={onNavigateToSubagent}
            userPrompt={item.message.role === 'user'}
            isStreaming={isAssistantMessage(item.message) && item.message.status === 'streaming'}
            collapseToolPreviews={item.collapseToolPreviews}
            serverUrl={serverUrl}
          />
        )}
      </MessageBubble>
      {isError && (
        <ErrorMessageContent message={item.message as AssistantMessage} />
      )}
    </>
  );
}, areMessageRowPropsEqual);

function areMessageRowPropsEqual(prev: MessageRowProps, next: MessageRowProps): boolean {
  return (
    prev.item.message === next.item.message &&
    prev.item.parts === next.item.parts &&
    prev.item.isQueued === next.item.isQueued &&
    prev.item.queueId === next.item.queueId &&
    prev.item.isSteer === next.item.isSteer &&
    prev.item.collapseToolPreviews === next.item.collapseToolPreviews &&
    prev.item.pendingSend === next.item.pendingSend &&
    prev.pendingSendActions === next.pendingSendActions &&
    prev.revertMessageId === next.revertMessageId &&
    prev.sessionId === next.sessionId &&
    prev.onNavigateToSubagent === next.onNavigateToSubagent &&
    prev.onRemoveFromQueue === next.onRemoveFromQueue &&
    prev.onSteerQueued === next.onSteerQueued &&
    prev.onRevert === next.onRevert &&
    prev.onFork === next.onFork &&
    prev.assistantOnlyFork === next.assistantOnlyFork &&
    prev.forkUnavailableReason === next.forkUnavailableReason &&
    prev.onEditMessage === next.onEditMessage &&
    prev.isMainActiveSession === next.isMainActiveSession &&
    prev.isCompacting === next.isCompacting &&
    prev.onCompact === next.onCompact &&
    prev.serverUrl === next.serverUrl &&
    prev.isPinned === next.isPinned &&
    prev.canPin === next.canPin &&
    prev.onTogglePinMessage === next.onTogglePinMessage &&
    prev.isPinningMessage === next.isPinningMessage
  );
}
