import { create } from 'zustand';

interface ConnectionState {
  connected: boolean;
  authError: string | null;
  connectionTimedOut: boolean;
  retryCount: number;
  nextRetryIn: number;
  /**
   * The drop was found when the page returned to the foreground, so the user
   * is looking at the screen: show the reconnect status at once.
   */
  foregroundRecovery: boolean;
  streamingSessionIds: Set<string>;
  interruptedSessions: Set<string>;
  /**
   * Sessions the user stopped whose turn the server has not finished yet. The
   * UI shows them idle at once; the server's running state stays untouched.
   */
  stoppingSessionIds: Set<string>;
}

interface ConnectionActions {
  setConnected: (connected: boolean) => void;
  setAuthError: (error: string | null) => void;
  setConnectionTimedOut: (timedOut: boolean) => void;
  setRetryCount: (updater: number | ((prev: number) => number)) => void;
  setNextRetryIn: (updater: number | ((prev: number) => number)) => void;
  resetConnection: () => void;
  clearStreamingSessions: () => void;
  addStreamingSession: (sessionId: string) => void;
  removeStreamingSession: (sessionId: string) => void;
  replaceStreamingSessions: (ids: Set<string> | string[]) => void;
  addInterruptedSession: (sessionId: string) => void;
  removeInterruptedSession: (sessionId: string) => void;
  clearInterruptedSessions: () => void;
  markSessionStopping: (sessionId: string) => void;
  clearSessionStopping: (sessionId: string) => void;
}

type ConnectionStore = ConnectionState & ConnectionActions;

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  authError: null,
  connectionTimedOut: false,
  retryCount: 0,
  nextRetryIn: 0,
  foregroundRecovery: false,
  streamingSessionIds: new Set<string>(),
  interruptedSessions: new Set<string>(),
  stoppingSessionIds: new Set<string>(),

  setConnected: (connected) => set({ connected }),
  setAuthError: (authError) => set({ authError }),
  setConnectionTimedOut: (connectionTimedOut) => set({ connectionTimedOut }),
  setRetryCount: (updater) =>
    set((state) => ({
      retryCount: typeof updater === 'function' ? updater(state.retryCount) : updater,
    })),
  setNextRetryIn: (updater) =>
    set((state) => ({
      nextRetryIn: typeof updater === 'function' ? updater(state.nextRetryIn) : updater,
    })),
  resetConnection: () => set({
    connected: false,
    authError: null,
    connectionTimedOut: false,
    retryCount: 0,
    nextRetryIn: 0,
    foregroundRecovery: false,
    streamingSessionIds: new Set<string>(),
    interruptedSessions: new Set<string>(),
    stoppingSessionIds: new Set<string>(),
  }),
  clearStreamingSessions: () => set({ streamingSessionIds: new Set<string>() }),
  addStreamingSession: (sessionId) => set((state) => {
    if (state.streamingSessionIds.has(sessionId)) return state;
    const next = new Set(state.streamingSessionIds);
    next.add(sessionId);
    return { streamingSessionIds: next };
  }),
  removeStreamingSession: (sessionId) => set((state) => {
    if (!state.streamingSessionIds.has(sessionId)) return state;
    const next = new Set(state.streamingSessionIds);
    next.delete(sessionId);
    return { streamingSessionIds: next };
  }),
  replaceStreamingSessions: (ids) => set({
    streamingSessionIds: ids instanceof Set ? ids : new Set(ids),
  }),
  addInterruptedSession: (sessionId) => set((state) => {
    if (state.interruptedSessions.has(sessionId)) return state;
    const next = new Set(state.interruptedSessions);
    next.add(sessionId);
    return { interruptedSessions: next };
  }),
  removeInterruptedSession: (sessionId) => set((state) => {
    if (!state.interruptedSessions.has(sessionId)) return state;
    const next = new Set(state.interruptedSessions);
    next.delete(sessionId);
    return { interruptedSessions: next };
  }),
  clearInterruptedSessions: () => set({ interruptedSessions: new Set<string>() }),
  markSessionStopping: (sessionId) => set((state) => {
    if (state.stoppingSessionIds.has(sessionId)) return state;
    const next = new Set(state.stoppingSessionIds);
    next.add(sessionId);
    return { stoppingSessionIds: next };
  }),
  clearSessionStopping: (sessionId) => set((state) => {
    if (!state.stoppingSessionIds.has(sessionId)) return state;
    const next = new Set(state.stoppingSessionIds);
    next.delete(sessionId);
    return { stoppingSessionIds: next };
  }),
}));
