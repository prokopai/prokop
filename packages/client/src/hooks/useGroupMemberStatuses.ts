import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AgentGroup, AgentGroupMember, AssistantMessage, Message, Part, ProkopaiClient, Session } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionContentStore } from '@/stores/sessionContentStore';
import { useAskStore, type PendingAskRequest } from '@/stores/askStore';
import { useAttentionStore } from '@/lib/attention';

export type GroupMemberStatus = 'idle' | 'working' | 'needs-you';

export interface GroupMemberState {
  member: AgentGroupMember;
  status: GroupMemberStatus;
  session: Session | null;
  /** Approvals and questions of this member that this client can answer. */
  asks: PendingAskRequest[];
}

const EMPTY_MEMBERS: AgentGroupMember[] = [];

/**
 * What each member is up to, from its hidden session: working (its session
 * runs), needs you (an approval or question waits, here or on the attention
 * feed), else idle. Member sessions are not in any list, so a row missing
 * from the store is fetched once.
 */
export function useGroupMemberStatuses(client: ProkopaiClient | null, serverId: string, group: AgentGroup | null | undefined): GroupMemberState[] {
  const members = group?.members ?? EMPTY_MEMBERS;
  const sessionIds = members.map((member) => member.sessionId);
  const sessions = useSessionStore(useShallow((state) => sessionIds.map((id) => state.sessions.find((session) => session.id === id) ?? null)));
  const streaming = useConnectionStore((state) => state.streamingSessionIds);
  // A member just stopped reads idle at once, as a session does; the server confirms when its turn has ended.
  const stopping = useConnectionStore((state) => state.stoppingSessionIds);
  const pendingRequests = useAskStore((state) => state.pendingRequests);
  const attentionAsks = useAttentionStore((state) => state.hosts[serverId]?.snapshot?.asks);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (!client) return;
    sessionIds.forEach((id, index) => {
      if (sessions[index] || requested.current.has(id)) return;
      requested.current.add(id);
      client.http.sessions.get(id)
        .then((response) => useSessionStore.getState().upsertSession(response.session))
        .catch(() => { requested.current.delete(id); });
    });
    // The joined key changes only when the roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionIds.join('\u0000'), sessions]);

  return useMemo(() => members.map((member, index) => {
    const session = sessions[index];
    const asks = pendingRequests.filter((request) => request.sessionId === member.sessionId || request.originSessionId === member.sessionId);
    const waiting = asks.length > 0 || (attentionAsks ?? []).some((ask) => ask.sessionId === member.sessionId);
    const working = (streaming.has(member.sessionId) || !!session?.runningAt) && !stopping.has(member.sessionId);
    return { member, session, asks, status: waiting ? 'needs-you' : working ? 'working' : 'idle' };
  }), [members, sessions, pendingRequests, attentionAsks, streaming, stopping]);
}

export interface GroupLiveReply {
  member: AgentGroupMember;
  /** The member's reply still being written in its session. */
  message: AssistantMessage;
  parts: Part[];
}

/**
 * Gives watched member sessions a place for their streamed messages. The
 * message handlers write only to sessions whose content exists in the store
 * (so a closed pane does not accumulate), and a watched session never
 * loaded a transcript; an empty entry opens the door. A later resume
 * replaces it with the real transcript.
 */
export function ensureMemberSessionContent(sessionIds: readonly string[]): void {
  const store = useSessionContentStore.getState();
  const missing = sessionIds.filter((id) => store.messagesBySession[id] === undefined);
  if (missing.length === 0) return;
  store.setMessagesBySession((prev) => {
    const next = { ...prev };
    for (const id of missing) if (next[id] === undefined) next[id] = [];
    return next;
  });
  store.setPartsBySession((prev) => {
    const next = { ...prev };
    for (const id of missing) if (next[id] === undefined) next[id] = {};
    return next;
  });
}

const EMPTY_PARTS: Part[] = [];

/** The reply a session is writing right now: its last message while it streams. */
export function liveReplyOf(messages: readonly Message[] | undefined, partsByMessage: Record<string, Part[]> | undefined): { message: AssistantMessage; parts: Part[] } | null {
  const last = messages?.at(-1);
  if (!last || last.role !== 'assistant' || last.status !== 'streaming') return null;
  return { message: last, parts: partsByMessage?.[last.id] ?? EMPTY_PARTS };
}

/**
 * Members' replies as they are written. The group view watches the member
 * sessions, so their parts stream into the content store like an open
 * session's; the finished reply arrives as a group message and the live one
 * disappears with the streaming status. The store is read as the members'
 * own slices (stable references), and the replies are built from those:
 * a selector that built new objects would read as a change on every render
 * and never settle.
 */
export function useGroupLiveReplies(members: readonly AgentGroupMember[]): GroupLiveReply[] {
  const slices = useSessionContentStore(useShallow((state) => members.flatMap((member) =>
    [state.messagesBySession[member.sessionId], state.partsBySession[member.sessionId]] as const)));
  return useMemo(() => members.flatMap((member, index) => {
    const live = liveReplyOf(slices[index * 2] as readonly Message[] | undefined, slices[index * 2 + 1] as Record<string, Part[]> | undefined);
    return live ? [{ member, ...live }] : [];
  }), [members, slices]);
}
