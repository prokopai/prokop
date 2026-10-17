import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { startSessionCacheSync, stopSessionCacheSync } from '@/lib/sessionCacheSync';
import { useOverviewSessions } from '@/hooks/useOverviewSessions';
import { useSessionStore } from '@/stores/sessionStore';

function session(id: string, title: string): Session {
  return { id, workspaceId: 'ws', title, status: 'active', parentId: null, metadata: null, tags: [] } as unknown as Session;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

function renderOverview(http: { listGrouped: () => Promise<unknown>; listByWorkspace?: () => Promise<unknown> }) {
  const sdkClient = { http: { sessions: http } } as unknown as ProkopaiClient;
  return renderHook(() => useOverviewSessions({ sdkClient, workspaceIds: ['ws'], connected: true }), { wrapper });
}

const title = (id: string) => useSessionStore.getState().sessions.find((s) => s.id === id)?.title;

describe('overview session pages and live updates', () => {
  beforeEach(() => {
    stopSessionCacheSync();
    queryClient.clear();
    useSessionStore.getState().setSessions([session('s1', 'Old title'), session('s2', 'Second')]);
    startSessionCacheSync();
  });
  afterEach(() => {
    queryClient.clear();
    useSessionStore.getState().clearSessions();
  });

  test('a rename that arrives while the overview loads is kept', async () => {
    const grouped = deferred<unknown>();
    renderOverview({ listGrouped: () => grouped.promise });

    // Live update while the request is in flight.
    act(() => useSessionStore.getState().upsertSession(session('s1', 'Renamed live')));
    await act(async () => grouped.resolve({
      sessions: { ws: [session('s1', 'Old title'), session('s2', 'Second'), session('s3', 'New from server')] },
      pagination: { ws: { hasMore: false, nextCursor: null } },
    }));

    await waitFor(() => expect(title('s3')).toBe('New from server'));
    expect(title('s1')).toBe('Renamed live');
  });

  test('loading more keeps live updates and adds the older sessions', async () => {
    const more = deferred<unknown>();
    const { result } = renderOverview({
      listGrouped: async () => ({
        sessions: { ws: [session('s1', 'Old title')] },
        pagination: { ws: { hasMore: true, nextCursor: 'cursor-1' } },
      }),
      listByWorkspace: () => more.promise,
    });
    await waitFor(() => expect(result.current.hasMoreByWorkspace.ws).toBe(true));

    act(() => result.current.fetchNextPageForWorkspace('ws'));
    act(() => useSessionStore.getState().upsertSession(session('s2', 'Second renamed live')));
    await act(async () => more.resolve({
      sessions: [session('s2', 'Second'), session('s4', 'Older one')],
      pagination: { hasMore: false, nextCursor: null },
    }));

    await waitFor(() => expect(title('s4')).toBe('Older one'));
    expect(title('s2')).toBe('Second renamed live');
  });
});
