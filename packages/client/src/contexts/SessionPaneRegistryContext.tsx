import { createContext, useContext } from 'react';

export interface SessionPaneHandle {
  focusInput(): void;
  scrollToBottom(): void;
  toggleAutoFollow(): void;
  /** Stops the work the pane shows; a group pane stops every working member. Session panes stop through the session commands instead. */
  stop?(): void;
}

/**
 * Registry of pane handles keyed by session ID.
 * Used by global keyboard shortcuts to target the focused pane.
 */
export interface SessionPaneRegistry {
  panes: Map<string, SessionPaneHandle>;
  register: (sessionId: string, handle: SessionPaneHandle) => void;
  unregister: (sessionId: string) => void;
  getHandle: (sessionId: string) => SessionPaneHandle | undefined;
}

export const SessionPaneRegistryContext = createContext<SessionPaneRegistry | null>(null);

export function useSessionPaneRegistry(): SessionPaneRegistry {
  const ctx = useContext(SessionPaneRegistryContext);
  if (!ctx) {
    throw new Error('useSessionPaneRegistry must be used within a SessionPaneRegistryProvider');
  }
  return ctx;
}
