import { useEffect, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { LegendList } from '@legendapp/list/react';
import { Loader2 } from 'lucide-react';
import type { MessageWithParts, Part, Message } from '@prokopai/sdk';
import { type SessionHarness, type SessionHarnessSwitch } from '@prokopai/sdk';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeftRight, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownFileLinkContext } from '@/components/shared/markdownFileLinks';
import { useFileLinkOpener } from '@/hooks/useContextFileOpener';
import { getToolPreviewCutoff } from '@/lib/toolPreviewPolicy';
import type { PendingSend } from '@/stores/pendingSendStore';
import { CompactionInProgressBanner, CompactionSuccessBanner, MessageRow } from './TranscriptRow';
import { useTranscriptFollow } from './useTranscriptFollow';
import type { TranscriptAnchor } from '@/lib/transcriptFollow';


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
  const { listRef, maintainAutoFollow, initialScroll, handleScroll } = useTranscriptFollow({
    displayItems,
    autoFollow,
    targetMessageId,
    initialAnchor,
    onAutoScrollChange,
    onSavePosition,
    scrollToBottomRef,
    onTargetMessageHandled,
    hasOlder,
    isLoadingOlder,
    onLoadOlder,
  });
  const [showCompactionBanner, setShowCompactionBanner] = useState(false);

  useLayoutEffect(() => {
    setShowCompactionBanner(isCompacting);
  }, [isCompacting]);

  useEffect(() => {
    if (compactionSuccess) {
      const timer = setTimeout(() => {
        onClearCompactionSuccess?.();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [compactionSuccess, onClearCompactionSuccess]);


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
