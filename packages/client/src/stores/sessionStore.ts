import { create } from 'zustand';
import type { Session } from '@prokopai/sdk';
import { useSessionContentStore } from '@/stores/sessionContentStore';

/** The session list. Loaded transcripts and per-session view state live in sessionContentStore. */

export interface ResumeSessionOptions {
  targetMessageId?: string;
  skipNavigation?: boolean;
}

type SessionsUpdater = Session[] | ((prev: Session[]) => Session[]);

interface SessionState {
  // --- Session List ---
  sessions: Session[];
}

interface SessionActions {
  // --- Session List ---
  setSessions: (updater: SessionsUpdater) => void;
  addSessionToFront: (session: Session) => void;
  /** Refreshes a known session where it is, so the list never reorders under the pointer. Unknown sessions join at the top. */
  upsertSession: (session: Session) => void;
  mergeSessions: (sessions: Session[]) => void;
  /** Moves the listed sessions to the front in the given order; others keep their order. */
  orderSessions: (ids: string[]) => void;
  replaceSessionsForWorkspace: (workspaceId: string, sessions: Session[]) => void;
  removeSessionsForWorkspace: (workspaceId: string) => void;
  updateSession: (session: Session) => void;
  removeSessionById: (sessionId: string) => void;
  clearSessions: () => void;

}

type SessionStore = SessionState & SessionActions;

export const useSessionStore = create<SessionStore>((set) => ({
  // --- Session List ---
  sessions: [],

  setSessions: (updater) =>
    set((state) => ({
      sessions: typeof updater === 'function' ? updater(state.sessions) : updater,
    })),

  addSessionToFront: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)],
    })),

  upsertSession: (session) =>
    set((state) => (state.sessions.some((s) => s.id === session.id)
      ? { sessions: state.sessions.map((s) => (s.id === session.id ? session : s)) }
      : { sessions: [session, ...state.sessions] })),

  mergeSessions: (incoming) =>
    set((state) => {
      const existing = new Map(state.sessions.map((s) => [s.id, s]));
      for (const session of incoming) {
        existing.set(session.id, session);
      }
      return { sessions: [...existing.values()] };
    }),

  orderSessions: (ids) =>
    set((state) => {
      const rank = new Map(ids.map((id, index) => [id, index]));
      const listed = state.sessions.filter((s) => rank.has(s.id))
        .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
      const next = [...listed, ...state.sessions.filter((s) => !rank.has(s.id))];
      return next.every((s, index) => s === state.sessions[index]) ? state : { sessions: next };
    }),

  replaceSessionsForWorkspace: (workspaceId, sessions) =>
    set((state) => ({
      sessions: [
        ...state.sessions.filter((s) => s.workspaceId !== workspaceId),
        ...sessions,
      ],
    })),

  removeSessionsForWorkspace: (workspaceId) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.workspaceId !== workspaceId),
    })),

  updateSession: (session) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
    })),

  removeSessionById: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
    })),

  clearSessions: () => set({ sessions: [] }),

}));

/** Clears the session list and all loaded content (server switch, logout). */
export function clearSessionState() {
  useSessionStore.getState().clearSessions();
  const content = useSessionContentStore.getState();
  content.clearQueuedMessages();
  content.setMessagesBySession({});
  content.setPartsBySession({});
  content.setContentMetaBySession({});
}
