import { beforeEach, expect, test } from 'vitest';
import type { Session, Workspace } from '@prokopai/sdk';
import { overviewReturnTarget, returnWorkspaceId, workspaceReturnTarget } from '@/lib/workspaceReturn';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';

beforeEach(() => {
  useServerDataStore.setState({ serverId: 'srv', workspaces: [{ id: 'a' }, { id: 'b' }] as Workspace[], activeWorkspaceId: 'a' });
  useSessionStore.setState({ sessions: [
    { id: 'a1', workspaceId: 'a' }, { id: 'a2', workspaceId: 'a' }, { id: 'b1', workspaceId: 'b' },
  ] as Session[] });
  useSessionBoardStore.setState({ openSessionIds: ['a1', 'b1', 'a2'], focusedSessionId: 'b1' });
});

test('a return to a workspace keeps its tabs, in order, with the focused one in front when it is one of them', () => {
  expect(workspaceReturnTarget('srv', 'a')).toEqual({
    to: '/server/$serverId/workspace/session/$sessionId', params: { serverId: 'srv', sessionId: 'a1' }, search: { open: 'a1,a2' },
  });
  expect(workspaceReturnTarget('srv', 'b')).toEqual({
    to: '/server/$serverId/workspace/session/$sessionId', params: { serverId: 'srv', sessionId: 'b1' }, search: {},
  });
  useSessionBoardStore.setState({ focusedSessionId: 'a2' });
  expect(workspaceReturnTarget('srv', 'a').params.sessionId).toBe('a2');
  expect(workspaceReturnTarget('srv', 'c')).toEqual({ to: '/server/$serverId/workspace', params: { serverId: 'srv' }, search: {} });
});

test('going to Overview keeps the tabs when the active group holds the workspace, else opens plain', () => {
  useSessionBoardStore.setState({ openSessionIds: ['a1', 'a2'], focusedSessionId: 'a2' });
  const groups = { version: 1 as const, groups: [{ id: 'g', serverId: 'srv', name: 'a + b', workspaceIds: ['b', 'a'] }], activeGroupIdByServer: { srv: 'g' } };
  useOverviewGroupsStore.setState({ hydrationStatus: 'ready', document: groups });
  expect(overviewReturnTarget('srv')).toEqual({
    to: '/server/$serverId/overview/session/$sessionId', params: { serverId: 'srv', sessionId: 'a2' }, search: { open: 'a1,a2' },
  });
  useServerDataStore.setState({ activeWorkspaceId: 'c' });
  expect(overviewReturnTarget('srv')).toEqual({ to: '/server/$serverId/overview', params: { serverId: 'srv' }, search: {} });
  useServerDataStore.setState({ activeWorkspaceId: 'a' });
  useOverviewGroupsStore.setState({ document: { ...groups, activeGroupIdByServer: {} } });
  expect(overviewReturnTarget('srv').to).toBe('/server/$serverId/overview');
});

test('the workspace to return to is the focused session\'s, else the active one', () => {
  expect(returnWorkspaceId()).toBe('b');
  useSessionBoardStore.setState({ focusedSessionId: null });
  expect(returnWorkspaceId()).toBe('a');
});
