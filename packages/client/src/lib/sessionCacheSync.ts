import { queryClient } from '@/components/providers/QueryProvider';
import { useSessionStore } from '@/stores/sessionStore';
import { queryKeys } from '@/lib/queryKeys';
import { dedupeAndSortSessions } from '@/lib/sessionUtils';
import type { Session } from '@prokopai/sdk';

let unsubscribe: (() => void) | null = null;

/** The store's sessions by id, taken when a request starts. */
export type SessionSnapshot = Map<string, Session>;

export function snapshotSessions(): SessionSnapshot {
  return new Map(useSessionStore.getState().sessions.map(s => [s.id, s]));
}

/**
 * Merges sessions fetched by a request that started at `baseline`. A session
 * that changed in the store since then (a live update or deletion) keeps its
 * newer state; rows unchanged since `previous` (the same list's last merge)
 * are skipped. Every fetched session list enters the store through here.
 * Returns this merge, to pass as `previous` next time.
 */
export function mergeFetchedSessions(incoming: Session[], baseline: SessionSnapshot, previous?: SessionSnapshot): SessionSnapshot {
  const current = snapshotSessions();
  useSessionStore.getState().mergeSessions(
    incoming.filter(s => previous?.get(s.id) !== s && current.get(s.id) === baseline.get(s.id)),
  );
  return new Map(incoming.map(s => [s.id, s]));
}

/** Overview's first page per workspace (`sessions.grouped*` keys). */
function isGroupedSessionsKey(key: readonly unknown[]): boolean {
  return key[0] === queryKeys.sessions.all[0] && key[1] === 'grouped';
}

function getWorkspaceId(key: readonly unknown[]): string | null {
  if (
    key[0] !== queryKeys.sessions.all[0] ||
    key[1] !== 'workspace' ||
    key[2] !== 'infinite'
  ) {
    return null;
  }
  const options = key[3];
  if (typeof options !== 'object' || options === null) return null;
  if (!('workspaceId' in options)) return null;
  if (typeof options.workspaceId !== 'string') return null;
  return options.workspaceId;
}

export function startSessionCacheSync(): void {
  if (unsubscribe) return;
  const snapshots = new Map<string, Map<string, Session>>();
  const mergedPages = new Map<string, Map<string, Session>>();
  unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'removed') return;
    if (isGroupedSessionsKey(event.query.queryKey)) {
      const hash = event.query.queryHash;
      if (event.type === 'removed') {
        snapshots.delete(hash);
        mergedPages.delete(hash);
        return;
      }
      if (event.action.type === 'fetch') snapshots.set(hash, snapshotSessions());
      if (event.action.type !== 'success') return;
      const data = event.query.state.data as { sessions?: Record<string, Session[]> } | undefined;
      if (!data?.sessions) return;
      // Only the first page per workspace: a missing row may just be further
      // down, so nothing is removed here.
      const baseline = snapshots.get(hash) ?? snapshotSessions();
      mergedPages.set(hash, mergeFetchedSessions(Object.values(data.sessions).flat(), baseline, mergedPages.get(hash)));
      snapshots.delete(hash);
      return;
    }
    const workspaceId = getWorkspaceId(event.query.queryKey);
    if (workspaceId === null) return;
    const options = event.query.queryKey[3] as { category?: string };
    if (options.category) {
      const hash = event.query.queryHash;
      if (event.type === 'removed') {
        snapshots.delete(hash);
        mergedPages.delete(hash);
        return; // Evicting one category must not erase other lists or open sessions.
      }
      if (event.action.type === 'fetch') {
        snapshots.set(hash, snapshotSessions());
      }
      if (event.action.type !== 'success') return;
      const data = event.query.state.data as { pages?: Array<{ sessions?: Session[] }> } | undefined;
      if (!data) return;
      const current = snapshotSessions();
      const baseline = snapshots.get(hash) ?? current;
      const incoming = dedupeAndSortSessions((data.pages ?? []).flatMap(page => page.sessions ?? []));
      // Preserve updates and deletions delivered while this request was in flight.
      const previous = mergedPages.get(hash);
      const incomingIds = new Set(incoming.map(s => s.id));
      // Reconcile rows removed while offline, without clearing other categories.
      for (const id of previous?.keys() ?? []) {
        const session = current.get(id);
        if (!session || incomingIds.has(id) || session !== baseline.get(id)) continue;
        const belongs = !session.parentId && !session.metadata?.learningRunId && (
          options.category === 'scheduled' ? Boolean(session.metadata?.scheduledJobId)
            : options.category === 'archived' ? session.status === 'closed'
              : session.status === 'active' && !session.metadata?.scheduledJobId
        );
        if (belongs) useSessionStore.getState().removeSessionById(id);
      }
      mergedPages.set(hash, mergeFetchedSessions(incoming, baseline, previous));
      // A session opened by URL can land in the store before its list. The
      // first page fixes its position; later refetches update rows in place.
      if (!previous) useSessionStore.getState().orderSessions(incoming.map(s => s.id));
      snapshots.delete(hash);
      return;
    }

    if (event.type === 'updated') {
      const data = event.query.state.data as
        | { pages?: Array<{ sessions?: Session[] }> }
        | undefined;
      if (!data) return;
      const sessions = (data.pages ?? []).flatMap((page) => page.sessions ?? []);
      useSessionStore.getState().replaceSessionsForWorkspace(
        workspaceId,
        dedupeAndSortSessions(sessions),
      );
    } else {
      useSessionStore.getState().removeSessionsForWorkspace(workspaceId);
    }
  });
}

export function stopSessionCacheSync(): void {
  unsubscribe?.();
  unsubscribe = null;
}
