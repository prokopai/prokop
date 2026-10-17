import { useEffect } from 'react';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useCompletionStore } from '@/stores/completionStore';
import { isUserAttending, subscribeUserActivity } from '@/lib/userActivity';

/**
 * Clears a session's "finished, not seen" mark once you look at it: its pane
 * is focused while the window is in front and you have touched the device
 * recently. Opening a session clears it too (session.resumed); this covers
 * switching to an already-open tab, coming back to the window, and the first
 * input after a run finished in front of an idle screen.
 */
export function UnreadTracker() {
  const focusedId = useSessionBoardStore((s) => s.focusedSessionId);
  const focusedUnread = useCompletionStore((s) => (focusedId ? s.completionState.has(focusedId) : false));

  useEffect(() => {
    if (!focusedId || !focusedUnread) return;
    const markSeen = () => {
      if (isUserAttending()) {
        useCompletionStore.getState().clearCompletion(focusedId);
      }
    };
    markSeen();
    window.addEventListener('focus', markSeen);
    document.addEventListener('visibilitychange', markSeen);
    const unsubscribe = subscribeUserActivity(markSeen);
    return () => {
      window.removeEventListener('focus', markSeen);
      document.removeEventListener('visibilitychange', markSeen);
      unsubscribe();
    };
  }, [focusedId, focusedUnread]);

  return null;
}
