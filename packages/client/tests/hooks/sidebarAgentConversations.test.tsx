import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Session, Workspace } from '@prokopai/sdk';
import { useSidebarData } from '@/hooks/useSidebarData';
import { AGENT_CONVERSATIONS_GROUP } from '@/lib/sessionTagOrder';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ sessionId: undefined }) }));
vi.mock('@/contexts/ServerContext', () => ({ useServerContext: () => ({ servers: [], quickConnections: [] }) }));

// The sidebar lists the active workspace's sessions: the recipient's home here.
const home = { id: 'marketing-home', name: 'marketing-home', path: '/agents/marketing/home' } as Workspace;
beforeEach(() => useServerDataStore.setState({ serverId: 'studio', activeWorkspaceId: home.id, workspaces: [home] }));

function session(id: string, overrides: Partial<Session> = {}): Session {
  return { id, workspaceId: 'marketing-home', title: id, status: 'active', parentId: null, harness: 'prokop',
    metadata: null, tags: [], updatedAt: '2026-10-23T10:00:00.000Z', ...overrides } as Session;
}

afterEach(() => act(() => useSessionStore.getState().clearSessions()));

test('conversations other agents started form their own group after the tags, whatever their tags say', () => {
  act(() => useSessionStore.getState().setSessions([
    session('own-work', { tags: ['launch'] }),
    session('untagged'),
    session('from-coding', { tags: ['launch'], metadata: { agentConversation: { senderSessionId: 's1', senderAgentId: 'coding' } } }),
    session('from-sales', { metadata: { agentConversation: { senderSessionId: 's2', senderAgentId: 'sales' } } }),
  ]));
  const { result } = renderHook(() => useSidebarData());
  expect(result.current.orderedTagNames).toEqual(['launch', AGENT_CONVERSATIONS_GROUP]);
  expect(result.current.tagGroups.get(AGENT_CONVERSATIONS_GROUP)?.map((s) => s.id)).toEqual(['from-coding', 'from-sales']);
  expect(result.current.tagGroups.get('launch')?.map((s) => s.id)).toEqual(['own-work']);
  expect(result.current.tagGroups.get('__ungrouped__')?.map((s) => s.id)).toEqual(['untagged']);
});

test('without conversations the group is absent', () => {
  act(() => useSessionStore.getState().setSessions([session('own-work')]));
  const { result } = renderHook(() => useSidebarData());
  expect(result.current.orderedTagNames).toEqual([]);
  expect(result.current.tagGroups.has(AGENT_CONVERSATIONS_GROUP)).toBe(false);
});
