import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { LegendListRef } from '@legendapp/list/react';
import {
  decideFollow,
  isUpwardScrollKey,
  isUpwardWheel,
  nestedScrollerTakesWheelUp,
  USER_SCROLL_INPUT_WINDOW_MS,
} from '@/lib/transcriptFollow';
import type { TranscriptAnchor } from '@/lib/transcriptFollow';
import type { DisplayItem } from './VirtualizedTranscript';

/** First visible message and how far it is scrolled into, in list coordinates. */
function readAnchor(state: ReturnType<LegendListRef['getState']>): TranscriptAnchor | null {
  const item = state.data[state.start] as DisplayItem | undefined;
  if (!item) return null;
  return {
    messageId: item.message.id,
    offset: Math.max(0, state.scroll - state.positionAtIndex(state.start)),
  };
}

interface TranscriptFollowOptions {
  displayItems: DisplayItem[];
  autoFollow: boolean;
  targetMessageId?: string | null;
  initialAnchor?: TranscriptAnchor | null;
  onAutoScrollChange?: (following: boolean) => void;
  onSavePosition?: (anchor: TranscriptAnchor | null) => void;
  scrollToBottomRef?: RefObject<(() => void) | null>;
  onTargetMessageHandled?: () => void;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder?: () => void;
}

/**
 * Keeps the transcript following the end while streaming, stops the moment the
 * reader scrolls up, jumps to a target message, restores the reading position
 * on remount and loads older pages near the top. Returns what LegendList needs.
 */
export function useTranscriptFollow({
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
}: TranscriptFollowOptions) {
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

  useEffect(() => () => {
    if (endCheckRafRef.current !== null) cancelAnimationFrame(endCheckRafRef.current);
    // A pending jump owns the position; saving would overwrite it.
    if (targetMessageIdRef.current) return;
    onSavePositionRef.current?.(autoScrollRef.current ? null : anchorRef.current);
  }, []);

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

  return { listRef, maintainAutoFollow, initialScroll, handleScroll };
}
