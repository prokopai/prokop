import { useRef, useEffect, useState, useCallback, useMemo, memo, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { buildApiUrl } from '@/config/urls';
import { LegendList, type LegendListRef } from '@legendapp/list/react';
import { ChevronDown, ChevronRight, Download, FileIcon, Braces, Loader2 } from 'lucide-react';
import type {
  MessageWithParts,
  Part,
  TextPart,
  Message,
  CompactionPart,
  AssistantMessage,
  StructuredOutputData,
} from '@prokopai/sdk';
import { isAssistantMessage, type SessionHarness, type SessionHarnessSwitch } from '@prokopai/sdk';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeftRight, Minimize2, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageBubble } from './MessageBubble';
import { UserPromptText } from './UserPromptText';
import { ErrorMessageContent } from './ErrorMessageContent';
import { ToolCall } from './ToolCall';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { MarkdownFileLinkContext } from '@/components/shared/markdownFileLinks';
import {
  assignRevealDelays,
  isRevealWhitespace,
  revealBatch,
  splitRevealTokens,
  STREAM_REVEAL_GENERATIONS,
} from '@/components/shared/markdownStreamReveal';
import { useFileLinkOpener } from '@/hooks/useContextFileOpener';
import { StructuredResponse } from '@/components/visualizations';
import { splitStreamingText } from './streamingText';
import { getToolPreviewCutoff } from '@/lib/toolPreviewPolicy';
import type { PendingSend } from '@/stores/pendingSendStore';
import {
  decideFollow,
  isUpwardScrollKey,
  isUpwardWheel,
  nestedScrollerTakesWheelUp,
  USER_SCROLL_INPUT_WINDOW_MS,
} from '@/lib/transcriptFollow';
import type { TranscriptAnchor } from '@/lib/transcriptFollow';
import { estimateReasoningMs, groupTurnParts } from '@/lib/turnParts';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolGroup } from './ToolGroup';


export interface DisplayItem {
  message: Message;
  parts: Part[];
  isQueued?: boolean;
  queueId?: string;
  /** A queued message marked to enter the running turn. */
  isSteer?: boolean;
  collapseToolPreviews?: boolean;
  /** Set while the prompt is shown ahead of the server persisting it. */
  pendingSend?: PendingSend;
}

/** Actions on a prompt the server has not persisted; `retry` is absent without session commands. */
export interface PendingSendActions {
  retry?: (clientMessageId: string) => void;
  edit: (clientMessageId: string) => void;
  discard: (clientMessageId: string) => void;
}

interface VirtualizedTranscriptProps {
  displayItems: DisplayItem[];
  messagesWithParts: MessageWithParts[];
  sessionId: string;
  sessionStatus?: string;
  onNavigateToSubagent?: (sessionId: string) => void;
  onRemoveFromQueue?: (queueId: string) => void;
  onSteerQueued?: (queueId: string) => void;
  pendingSendActions?: PendingSendActions;
  onRevert?: (sessionId: string, stepPartId: string) => void;
  onFork?: (sessionId: string, messageId: string) => void;
  assistantOnlyFork?: boolean;
  forkUnavailableReason?: string;
  onEditMessage?: (sessionId: string, messageId: string, content: string) => void;
  onCompact?: () => void;
  isMainActiveSession?: boolean;
  isCompacting?: boolean;
  compactedAfterMessageId?: string;
  harnessSwitches?: SessionHarnessSwitch[];
  compactionSuccess?: boolean;
  onClearCompactionSuccess?: () => void;
  autoFollow?: boolean;
  onAutoScrollChange?: (enabled: boolean) => void;
  scrollToBottomRef?: React.RefObject<(() => void) | null>;
  serverUrl?: string;
  pinnedMessageIds?: Set<string>;
  onTogglePinMessage?: (message: Message) => void;
  isPinningMessage?: boolean;
  targetMessageId?: string | null;
  onTargetMessageHandled?: () => void;
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  loadOlderError?: string | null;
  onLoadOlder?: () => void;
  emptyContent?: ReactNode;
  /** Free-mode reading position to restore on mount. */
  initialAnchor?: TranscriptAnchor;
  /** Called on unmount with the reading position, or null while following. */
  onSavePosition?: (anchor: TranscriptAnchor | null) => void;
}

/** First visible message and how far it is scrolled into, in list coordinates. */
function readAnchor(state: ReturnType<LegendListRef['getState']>): TranscriptAnchor | null {
  const item = state.data[state.start] as DisplayItem | undefined;
  if (!item) return null;
  return {
    messageId: item.message.id,
    offset: Math.max(0, state.scroll - state.positionAtIndex(state.start)),
  };
}

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
function formatInvertedText(text: string): string {
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

function CompactionInProgressBanner() {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-foreground bg-muted rounded-lg px-3 py-2 border border-border shadow-sm">
      <Minimize2 className="size-4 animate-pulse" />
      <span>Compacting conversation...</span>
    </div>
  );
}

function CompactionSuccessBanner() {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400 bg-green-500/15 rounded-lg px-3 py-2 border border-green-500/30 shadow-sm">
      <CheckCircle2 className="size-4" />
      <span>Compaction complete</span>
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
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-destructive ml-3">
        <AlertTriangle className="size-3" />
        Compaction Failed
      </div>
      <div className="rounded-2xl px-4 py-3 max-w-full bg-destructive/10 border border-destructive/30 rounded-bl-md">
        <p className="text-sm text-destructive/90">
          {textContent || message.error || 'Compaction failed. The conversation could not be summarized.'}
        </p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-2 h-7 text-xs gap-1.5"
          >
            <RotateCcw className="size-3" />
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
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="border-b border-dashed border-muted-foreground/40 pb-px">
          {reason === 'overflow' ? 'Context overflow' : reason === 'auto' ? 'Auto' : 'Manual'} compaction
        </span>
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-muted-foreground italic">
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

const StreamBlock = memo(function StreamBlock({ block }: { block: string }) {
  return <MarkdownRenderer>{block}</MarkdownRenderer>;
});

const NO_REVEAL_BATCHES: readonly number[] = [];

/**
 * Offsets in `text` where each of the last few changes started, oldest
 * first: the words that arrived in those flushes are still fading in. A
 * mount starts with nothing to reveal (no replay), and a re-render without
 * new text keeps the same batches, so running fades continue.
 */
function useRevealBatches(text: string): readonly number[] {
  const [state, setState] = useState({ text, batches: NO_REVEAL_BATCHES });
  if (state.text !== text) {
    const start = Math.min(state.text.length, text.length);
    setState({
      text,
      batches: [...state.batches.filter((batch) => batch < start), start].slice(-STREAM_REVEAL_GENERATIONS),
    });
  }
  return state.batches;
}

/**
 * Streamed text renders once per store flush, never per frame. Finished
 * blocks are memoized and never re-parse; only the growing tail does, and its
 * newest words fade in through CSS. Same renderer for tail and blocks, so a
 * block graduating from the tail is pixel-identical (no typography pop).
 */
function StreamingText({ text, active }: { text: string; active: boolean }) {
  const batches = useRevealBatches(text);
  // Frozen first-render flag: a fresh mount of already-complete text skips the
  // block split and renders once (identical visuals, single parse).
  const [mountedInactive] = useState(!active);

  if (!active && mountedInactive) {
    return <MarkdownRenderer>{text}</MarkdownRenderer>;
  }

  const { blocks, tail } = splitStreamingText(text);
  const tailStart = text.length - tail.length;
  // Only the live tail part fades; a part that stopped streaming renders settled.
  const tailBatches = active ? batches.map((batch) => batch - tailStart) : undefined;

  return (
    <div className="min-w-0">
      {blocks.map((block, index) => (
        <StreamBlock key={`${index}:${block.length}`} block={block} />
      ))}
      {tail && <MarkdownRenderer revealBatches={tailBatches}>{tail}</MarkdownRenderer>}
    </div>
  );
}

/**
 * Reasoning is plain text. Earlier paragraphs render as one text node; the
 * current one wraps each word so its newest words can fade in.
 */
function StreamingReasoning({ text, active }: { text: string; active: boolean }) {
  const batches = useRevealBatches(text);
  if (!active) return <>{text}</>;
  const paragraphStart = text.lastIndexOf('\n\n') + 1;
  let position = paragraphStart;
  const tokens = splitRevealTokens(text.slice(paragraphStart)).map((token) => {
    const offset = position;
    position += token.length;
    return { token, batch: isRevealWhitespace(token) ? null : revealBatch(offset, batches) };
  });
  const reveal = assignRevealDelays(tokens.flatMap(({ batch }) => batch === null ? [] : [batch]));
  let wordIndex = 0;
  return (
    <>
      {text.slice(0, paragraphStart)}
      {tokens.map(({ token, batch }, index) => {
        if (batch === null) return token;
        const { delayMs } = reveal[wordIndex++];
        return batch < 0
          ? <span key={index}>{token}</span>
          : <span key={index} className="stream-in" style={{ animationDelay: `${delayMs}ms` }}>{token}</span>;
      })}
    </>
  );
}

const MessageParts = memo(function MessageParts({
  collapseToolPreviews = false,
  sessionId,
  parts,
  onNavigateToSubagent,
  inverted = false,
  userPrompt = false,
  isStreaming = false,
  serverUrl,
}: {
  sessionId: string;
  parts: Part[];
  onNavigateToSubagent?: (sessionId: string) => void;
  inverted?: boolean;
  /** Text parts of a user message: context references render as chips. */
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
              <UserPromptText text={part.text} sessionId={sessionId} inverted={inverted}
                formatBody={inverted ? formatInvertedText : undefined} />
            </div>
          );
        }
        const text = inverted && part.text
          ? formatInvertedText(part.text)
          : (part.text || '...');
        if (isStreaming && !inverted) STREAMED_PART_IDS.add(part.id);
        const streamingPath = !inverted && (isStreaming || STREAMED_PART_IDS.has(part.id));
        return (
          <div key={part.id} className="min-w-0">
            {streamingPath ? (
              <StreamingText text={text} active={animate} />
            ) : (
              <MarkdownRenderer inverted={inverted}>{text}</MarkdownRenderer>
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
            className="visualization-container text-muted-foreground text-sm italic border-l-2 border-muted-foreground/30 pl-3 my-2 wrap-break-word"
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
            className={cn(
              'max-w-full max-h-64 rounded-xl mt-2 object-contain',
              inverted && 'ring-2 ring-white/20'
            )}
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
            className={cn(
              'mt-2 p-2 rounded-lg text-sm flex items-center gap-2 transition-colors',
              inverted
                ? 'bg-white/15 hover:bg-white/25 text-primary-foreground'
                : 'bg-muted hover:bg-accent'
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileIcon className="size-4 shrink-0" />
            <span className="truncate">{displayName}</span>
            {ext && (
              <span className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ml-auto shrink-0',
                inverted
                  ? 'bg-white/25 text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              )}>
                {ext}
              </span>
            )}
            <Download className="size-3.5 shrink-0 opacity-60" />
          </a>
        );
      }

      default:
        return null;
    }
  };

  if (inverted) return <>{parts.map(renderPart)}</>;

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
  if (prev.inverted !== next.inverted) return false;
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
          <div className="flex items-center gap-2 py-1 hover:text-foreground transition-colors text-muted-foreground">
            <Braces className="size-3 text-primary" />
            {rawOpen ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <span className="text-xs">
              Raw Output
              {structuredOutput.formatName && (
                <span className="text-muted-foreground"> · {structuredOutput.formatName}</span>
              )}
            </span>
          </div>
        </CollapsibleTrigger>
        {rawOpen && (
          <CollapsibleContent>
            <div className="pb-2">
              <MessageParts
                sessionId={sessionId}
                parts={parts}
                onNavigateToSubagent={onNavigateToSubagent}
                inverted={false}
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

const MessageRow = memo(function MessageRow({
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
            inverted={item.message.role === 'user' && !item.isQueued}
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

function EmptyTranscript() {
  return (
    <div className="text-center py-16 text-muted-foreground px-4">
      <p className="text-lg mb-2">Start a conversation</p>
      <p className="text-sm">Send a message below to begin.</p>
    </div>
  );
}

function keyExtractor(item: DisplayItem): string {
  return item.message.id;
}

const HARNESS_NAMES: Record<SessionHarness, string> = {
  prokop: 'Prokop',
  'codex-cli': 'Codex CLI',
  'claude-cli': 'Claude CLI',
};

export function VirtualizedTranscript({
  displayItems: sourceItems,
  messagesWithParts,
  sessionId,
  sessionStatus,
  isCompacting = false,
  compactedAfterMessageId,
  harnessSwitches,
  compactionSuccess = false,
  onClearCompactionSuccess,
  onNavigateToSubagent,
  onRemoveFromQueue,
  onSteerQueued,
  pendingSendActions,
  onRevert,
  onFork,
  assistantOnlyFork = false,
  forkUnavailableReason,
  onEditMessage,
  onCompact,
  isMainActiveSession = false,
  autoFollow = true,
  onAutoScrollChange,
  scrollToBottomRef,
  serverUrl,
  pinnedMessageIds,
  onTogglePinMessage,
  isPinningMessage,
  targetMessageId,
  onTargetMessageHandled,
  hasOlder = false,
  isLoadingOlder = false,
  loadOlderError = null,
  onLoadOlder,
  emptyContent,
  initialAnchor,
  onSavePosition,
}: VirtualizedTranscriptProps) {
  const displayItems = useMemo(() => {
    const cutoff = getToolPreviewCutoff(sourceItems);
    return sourceItems.map((item, index) => ({
      ...item,
      collapseToolPreviews: index < cutoff && item.message.role === 'assistant',
    }));
  }, [sourceItems]);
  const listRef = useRef<LegendListRef | null>(null);
  const autoScrollRef = useRef(autoFollow);
  const endCheckRafRef = useRef<number | null>(null);
  const targetMessageIdRef = useRef(targetMessageId);
  const lastUserScrollAtRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const anchorRef = useRef<TranscriptAnchor | null>(initialAnchor ?? null);
  const onSavePositionRef = useRef(onSavePosition);

  const [maintainAutoFollow, setMaintainAutoFollow] = useState(autoFollow);
  const onAutoScrollChangeRef = useRef(onAutoScrollChange);
  useEffect(() => {
    onAutoScrollChangeRef.current = onAutoScrollChange;
    onSavePositionRef.current = onSavePosition;
  }, [onAutoScrollChange, onSavePosition]);

  // Resolved once: a remount restores where the reader left this session.
  const [initialScroll] = useState(() => {
    if (!initialAnchor || targetMessageId) return undefined;
    const index = displayItems.findIndex(item => item.message.id === initialAnchor.messageId);
    return index >= 0 ? { index, viewOffset: -initialAnchor.offset } : undefined;
  });

  useLayoutEffect(() => {
    targetMessageIdRef.current = targetMessageId;
  }, [targetMessageId]);
  const [showCompactionBanner, setShowCompactionBanner] = useState(false);

  /**
   * LegendList's maintainScrollAtEnd keeps a following list pinned through
   * data, item size and layout changes. This is the one fallback for cases
   * it cannot see (first data after mount, a re-follow request): at most one
   * check per frame, and it scrolls only when the view is not at the end.
   */
  const scheduleEndCheck = useCallback(() => {
    if (endCheckRafRef.current !== null) cancelAnimationFrame(endCheckRafRef.current);
    endCheckRafRef.current = requestAnimationFrame(() => {
      endCheckRafRef.current = null;
      if (targetMessageIdRef.current || !autoScrollRef.current) return;
      const scrollEl = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
      if (scrollEl && scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= 1) return;
      void listRef.current?.scrollToEnd({ animated: false });
    });
  }, []);

  const setFollowing = useCallback((next: boolean) => {
    if (autoScrollRef.current === next) return;
    autoScrollRef.current = next;
    if (next) {
      setMaintainAutoFollow(true);
    } else {
      if (endCheckRafRef.current !== null) {
        cancelAnimationFrame(endCheckRafRef.current);
        endCheckRafRef.current = null;
      }
      // LegendList pins on item resize, which can run in the same frame as
      // the scroll. A batched update would arrive after that pin and undo
      // the user's scroll, so turning it off commits synchronously.
      flushSync(() => setMaintainAutoFollow(false));
    }
    onAutoScrollChangeRef.current?.(next);
  }, []);

  useLayoutEffect(() => {
    setShowCompactionBanner(isCompacting);
  }, [isCompacting]);

  useEffect(() => () => {
    if (endCheckRafRef.current !== null) cancelAnimationFrame(endCheckRafRef.current);
    // A pending jump owns the position; saving would overwrite it.
    if (targetMessageIdRef.current) return;
    onSavePositionRef.current?.(autoScrollRef.current ? null : anchorRef.current);
  }, []);

  useEffect(() => {
    if (compactionSuccess) {
      const timer = setTimeout(() => {
        onClearCompactionSuccess?.();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [compactionSuccess, onClearCompactionSuccess]);

  useLayoutEffect(() => {
    if (targetMessageId) {
      autoScrollRef.current = false;
      setMaintainAutoFollow(false);
      return;
    }

    autoScrollRef.current = autoFollow;
    setMaintainAutoFollow(autoFollow);
  }, [autoFollow, targetMessageId]);

  useLayoutEffect(() => {
    if (displayItems.length === 0 || targetMessageId || !autoFollow) return;
    scheduleEndCheck();
  }, [displayItems, autoFollow, targetMessageId, scheduleEndCheck]);

  // LegendList's maintainScrollAtEnd scrolls a frame after it measures, and
  // only while the view is within its end threshold. Growth was painted below
  // the fold first, and one taller than the threshold (a long prompt, a big
  // tool output) left a following view stranded above the end. Pin in the
  // same frame instead: mutations cover new rows, streamed text and
  // LegendList's size writes; the resize covers the composer growing or
  // shrinking the viewport.
  useEffect(() => {
    const scrollEl = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
    if (!scrollEl) return;
    const pin = () => {
      if (!autoScrollRef.current || targetMessageIdRef.current) return;
      const end = scrollEl.scrollHeight - scrollEl.clientHeight;
      if (end - scrollEl.scrollTop > 1) scrollEl.scrollTop = end;
    };
    const resize = new ResizeObserver(pin);
    resize.observe(scrollEl);
    const mutation = new MutationObserver(pin);
    mutation.observe(scrollEl, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'],
    });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (scrollToBottomRef) {
      scrollToBottomRef.current = () => {
        autoScrollRef.current = true;
        setMaintainAutoFollow(true);
        scheduleEndCheck();
      };
    }
  }, [scrollToBottomRef, scheduleEndCheck]);

  useEffect(() => {
    const scrollEl = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
    if (!scrollEl) return;

    // Inputs that clearly scroll up stop following before the browser
    // scrolls, so a fast stream never gets a frame to pull the view back.
    // Everything else only marks the moment and handleScroll decides from
    // the resulting movement (scrollbar drags, selection, find in page).
    let pointerHeld = false;
    let touchY: number | null = null;
    const canScrollUp = (target: EventTarget | null) =>
      scrollEl.scrollTop > 0 && !nestedScrollerTakesWheelUp(target, scrollEl);

    const markUserScrollInput = () => {
      lastUserScrollAtRef.current = Date.now();
    };

    const onWheel = (event: WheelEvent) => {
      markUserScrollInput();
      if (isUpwardWheel(event.deltaX, event.deltaY) && canScrollUp(event.target)) setFollowing(false);
    };

    const onTouchStart = (event: TouchEvent) => {
      markUserScrollInput();
      touchY = event.touches[0]?.clientY ?? null;
    };

    // A finger moving down drags the content down, which scrolls up.
    const onTouchMove = (event: TouchEvent) => {
      markUserScrollInput();
      const y = event.touches[0]?.clientY;
      if (touchY !== null && y !== undefined && y > touchY + 3 && canScrollUp(event.target)) {
        setFollowing(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      markUserScrollInput();
      const target = event.target;
      const editing = target instanceof HTMLElement
        && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
      if (!editing && isUpwardScrollKey(event.key, event.shiftKey) && scrollEl.scrollTop > 0) {
        setFollowing(false);
      }
    };

    const onMouseDown = () => {
      pointerHeld = true;
      markUserScrollInput();
    };

    // Scrollbar drags and text selection that auto-scrolls both hold the button.
    const onMouseMove = () => {
      if (pointerHeld) markUserScrollInput();
    };

    const onMouseUp = () => {
      pointerHeld = false;
    };

    scrollEl.addEventListener('wheel', onWheel, { passive: true });
    scrollEl.addEventListener('touchstart', onTouchStart, { passive: true });
    scrollEl.addEventListener('touchmove', onTouchMove, { passive: true });
    scrollEl.addEventListener('keydown', onKeyDown, { passive: true });
    scrollEl.addEventListener('mousedown', onMouseDown, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseup', onMouseUp, { passive: true });

    return () => {
      scrollEl.removeEventListener('wheel', onWheel);
      scrollEl.removeEventListener('touchstart', onTouchStart);
      scrollEl.removeEventListener('touchmove', onTouchMove);
      scrollEl.removeEventListener('keydown', onKeyDown);
      scrollEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [setFollowing]);

  useEffect(() => {
    if (!targetMessageId) return;

    const targetIndex = displayItems.findIndex(item => item.message.id === targetMessageId);
    if (targetIndex < 0) return;

    autoScrollRef.current = false;
    setMaintainAutoFollow(false);
    onAutoScrollChangeRef.current?.(false);

    listRef.current?.scrollToIndex?.({ index: targetIndex, animated: true });

    const timeout = window.setTimeout(() => {
      onTargetMessageHandled?.();
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [targetMessageId, displayItems, onTargetMessageHandled]);

  const handleScroll = useCallback(() => {
    const scrollEl = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
    if (!scrollEl) return;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = scrollEl.scrollTop;

    if (targetMessageIdRef.current) return;

    if (hasOlder && !isLoadingOlder && onLoadOlder && scrollEl.scrollTop < 200) {
      onLoadOlder();
    }

    const next = decideFollow({
      scrollTop: scrollEl.scrollTop,
      previousScrollTop,
      scrollHeight: scrollEl.scrollHeight,
      clientHeight: scrollEl.clientHeight,
      userDriven: Date.now() - lastUserScrollAtRef.current < USER_SCROLL_INPUT_WINDOW_MS,
    }, autoScrollRef.current);
    if (next !== null) setFollowing(next);

    if (!autoScrollRef.current) {
      const state = listRef.current?.getState();
      if (state) anchorRef.current = readAnchor(state);
    }
  }, [hasOlder, isLoadingOlder, onLoadOlder, setFollowing]);

  const revertMessageIds = useMemo(() => {
    const ids = new Map<string, string | null>();
    let previousCompletedAssistantId: string | null = null;

    messagesWithParts.forEach(({ message }, index) => {
      if (message.role === 'user') {
        ids.set(message.id, index === 0 ? message.id : previousCompletedAssistantId);
      } else if (message.role === 'assistant' && message.status !== 'streaming') {
        previousCompletedAssistantId = message.id;
      }
    });

    return ids;
  }, [messagesWithParts]);

  const openFileLink = useFileLinkOpener(sessionId);
  const switchMarkers = useMemo(() => new Map((harnessSwitches ?? []).map(entry =>
    [entry.afterMessageId, `Switched to ${HARNESS_NAMES[entry.to]} · ${entry.modelId}`])), [harnessSwitches]);

  const renderItem = useCallback(({ item }: { item: DisplayItem }) => (
    <div
      className={cn(
        'mx-auto w-full max-w-3xl px-4 py-4',
        item.message.id === targetMessageId && 'rounded-lg ring-2 ring-primary/40 bg-primary/5',
      )}
    >
      <MessageRow
        item={item}
        revertMessageId={revertMessageIds.get(item.message.id) ?? null}
        sessionId={sessionId}
        onNavigateToSubagent={onNavigateToSubagent}
        onRemoveFromQueue={onRemoveFromQueue}
        onSteerQueued={onSteerQueued}
        pendingSendActions={pendingSendActions}
        onRevert={onRevert}
        onFork={onFork}
        assistantOnlyFork={assistantOnlyFork}
        forkUnavailableReason={forkUnavailableReason}
        onEditMessage={onEditMessage}
        isMainActiveSession={isMainActiveSession}
        isCompacting={isCompacting}
        onCompact={onCompact}
        serverUrl={serverUrl}
        isPinned={pinnedMessageIds?.has(item.message.id) ?? false}
        canPin={item.message.role === 'assistant' && !item.isQueued}
        onTogglePinMessage={
          item.message.role === 'assistant' && !item.isQueued
            ? onTogglePinMessage
            : undefined
        }
        isPinningMessage={isPinningMessage}
      />
      {switchMarkers.has(item.message.id) && (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground" role="status">
          <span className="h-px w-8 bg-border" />
          <ArrowLeftRight className="size-3" />
          {switchMarkers.get(item.message.id)}
          <span className="h-px w-8 bg-border" />
        </div>
      )}
      {item.message.id === compactedAfterMessageId && (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground" role="status">
          <span className="h-px w-8 bg-border" />
          <Minimize2 className="size-3" />
          Context compacted
          <span className="h-px w-8 bg-border" />
        </div>
      )}
    </div>
  ), [
    revertMessageIds,
    sessionId,
    onNavigateToSubagent,
    onRemoveFromQueue,
    onSteerQueued,
    pendingSendActions,
    onRevert,
    onFork,
    assistantOnlyFork,
    forkUnavailableReason,
    onEditMessage,
    isMainActiveSession,
    isCompacting,
    compactedAfterMessageId,
    switchMarkers,
    onCompact,
    serverUrl,
    pinnedMessageIds,
    onTogglePinMessage,
    isPinningMessage,
    targetMessageId,
  ]);

  // Mutation callbacks must be part of extraData: LegendList re-renders
  // mounted rows on extraData identity change only, so a control-state flip
  // (callbacks withheld/restored) would otherwise leave stale row buttons.
  const listExtraData = useMemo(() => ({
    pinnedMessageIds,
    isPinningMessage,
    onRemoveFromQueue,
    onSteerQueued,
    pendingSendActions,
    onRevert,
    onFork,
    onEditMessage,
    onCompact,
    compactedAfterMessageId,
    switchMarkers,
  }), [
    pinnedMessageIds,
    isPinningMessage,
    onRemoveFromQueue,
    onSteerQueued,
    pendingSendActions,
    onRevert,
    onFork,
    onEditMessage,
    onCompact,
    compactedAfterMessageId,
    switchMarkers,
  ]);

  const header = (
    <>
      {isLoadingOlder && (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {loadOlderError && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-destructive">
          <span>Failed to load older messages</span>
          <button onClick={onLoadOlder} className="underline hover:text-foreground">Retry</button>
        </div>
      )}

      {showCompactionBanner && (
        <div className="sticky top-0 z-10 px-4 pt-4 pb-1 bg-gradient-to-b from-background via-background/95 to-transparent">
          <CompactionInProgressBanner />
        </div>
      )}

      {compactionSuccess && (
        <div className="sticky top-0 z-10 px-4 pt-4 pb-1 bg-gradient-to-b from-background via-background/95 to-transparent">
          <CompactionSuccessBanner />
        </div>
      )}

      {sessionStatus === 'closed' && (
        <Alert className="mx-4 mt-4">
          <AlertDescription>
            This session is archived. You can reopen it from the sidebar.
          </AlertDescription>
        </Alert>
      )}
    </>
  );

  return (
    <MarkdownFileLinkContext.Provider value={openFileLink}>
    <LegendList
      ref={listRef}
      data={displayItems}
      extraData={listExtraData}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      // Rows run 100-3000px. The first window is sized from this estimate and
      // recycled containers keep their rows, so a low value leaves ~20 rows
      // mounted far offscreen for the whole session.
      estimatedItemSize={400}
      drawDistance={800}
      initialScrollAtEnd={!targetMessageId && autoFollow}
      initialScrollIndex={initialScroll}
      maintainScrollAtEnd={!targetMessageId && maintainAutoFollow ? { animated: false } : false}
      maintainScrollAtEndThreshold={0.1}
      // History rows change height as they are measured or previews are expanded.
      maintainVisibleContentPosition={{ data: true, size: true }}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative chat-transcript-scrollbar select-text"
      style={{ WebkitOverflowScrolling: 'touch' }}
      ListHeaderComponent={header}
      ListEmptyComponent={emptyContent ? () => emptyContent : EmptyTranscript}
    />
    </MarkdownFileLinkContext.Provider>
  );
}
