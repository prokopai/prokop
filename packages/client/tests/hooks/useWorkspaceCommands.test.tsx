import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session, Workspace } from '@prokopai/sdk';
import { useWorkspaceCommands } from '@/hooks/useWorkspaceCommands';
import { useServerDataStore, selectActiveWorkspace } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionContentStore } from '@/stores/sessionContentStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const alpha = { id: 'alpha', name: 'Alpha', path: '/alpha' } as Workspace;
const beta = { id: 'beta', name: 'Beta', path: '/beta' } as Workspace;

function setup(http: Record<string, unknown>, currentSession: Session | null = null) {
  const navigate = vi.fn();
  const onSessionsDeleted = vi.fn();
  const removeFromQuickConnectionsByWorkspace = vi.fn();
  const clientRef = { current: { httpClient: http } as unknown as ProkopaiClient };
  const { result } = renderHook(() => useWorkspaceCommands({
    clientRef, serverId: 'server', navigate, currentSession, removeFromQuickConnectionsByWorkspace, onSessionsDeleted,
  }));
  return { result, navigate, onSessionsDeleted, removeFromQuickConnectionsByWorkspace };
}

describe('useWorkspaceCommands', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useServerDataStore.setState({ serverId: 'server', workspaces: [alpha, beta], activeWorkspaceId: 'beta' });
    useSessionStore.setState({ sessions: [{ id: 's1', workspaceId: 'beta' } as Session, { id: 's2', workspaceId: 'alpha' } as Session] });
    useSessionContentStore.setState({ messagesBySession: { s1: [], s2: [] } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    toast.success.mockReset();
    toast.error.mockReset();
    localStorage.clear();
  });

  test('opening together finds or creates the Overview group with that set and carries the board over in the URL', () => {
    useOverviewGroupsStore.setState({ hydrationStatus: 'ready', document: { version: 1, groups: [], activeGroupIdByServer: {} } });
    useSessionBoardStore.setState({ focusedSessionId: 's1', openSessionIds: ['s1', 's2'] });
    const { result, navigate } = setup({});

    act(() => result.current.openWithWorkspaces(['alpha']));
    const groups = useOverviewGroupsStore.getState().document;
    expect(groups.groups).toEqual([{ id: expect.any(String), serverId: 'server', name: 'Beta + Alpha', workspaceIds: ['beta', 'alpha'] }]);
    expect(groups.activeGroupIdByServer.server).toBe(groups.groups[0]!.id);
    expect(navigate).toHaveBeenLastCalledWith({ to: '/server/$serverId/overview/session/$sessionId', params: { serverId: 'server', sessionId: 's1' }, search: { open: 's1,s2' } });

    // The same set in another order reuses the group; nothing new is created.
    act(() => useOverviewGroupsStore.getState().createGroup('server', 'Other', ['alpha']));
    act(() => result.current.openWithWorkspaces(['alpha', 'beta']));
    expect(useOverviewGroupsStore.getState().document.groups.map((group) => group.name)).toEqual(['Beta + Alpha', 'Other']);
    expect(useOverviewGroupsStore.getState().document.activeGroupIdByServer.server).toBe(groups.groups[0]!.id);

    // Nothing focused: Overview opens plain.
    useSessionBoardStore.setState({ focusedSessionId: null, openSessionIds: [] });
    act(() => result.current.openWithWorkspaces(['alpha']));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/server/$serverId/overview', params: { serverId: 'server' } });
  });

  test('selecting a workspace keeps the tabs that belong to it and drops the others', () => {
    useSessionBoardStore.setState({ focusedSessionId: 's1', openSessionIds: ['s1', 's2'] });
    const { result, navigate } = setup({});
    act(() => result.current.selectWorkspace(alpha));
    expect(useServerDataStore.getState().activeWorkspaceId).toBe('alpha');
    expect(navigate).toHaveBeenLastCalledWith({ to: '/server/$serverId/workspace/session/$sessionId', params: { serverId: 'server', sessionId: 's2' }, search: {} });
    useSessionBoardStore.setState({ focusedSessionId: null, openSessionIds: [] });
    act(() => result.current.selectWorkspace(beta));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/server/$serverId/workspace', params: { serverId: 'server' }, search: {} });
  });

  test('a rename updates the list, so the active workspace shows the new name', async () => {
    const patch = vi.fn().mockResolvedValue({ workspace: { ...beta, name: 'Beta 2' } });
    const { result } = setup({ patch });
    await act(() => result.current.renameWorkspace('beta', 'Beta 2'));
    expect(patch).toHaveBeenCalledWith('/workspaces/beta', { name: 'Beta 2' });
    expect(selectActiveWorkspace(useServerDataStore.getState())?.name).toBe('Beta 2');
    expect(result.current.isUpdatingWorkspace).toEqual({});
  });

  test('settings save reports success; a failed change reports the error and keeps the list', async () => {
    const patch = vi.fn()
      .mockResolvedValueOnce({ workspace: { ...alpha, settings: { permissionMode: 'standard' } } })
      .mockRejectedValueOnce(new Error('disk full'));
    const { result } = setup({ patch });
    await act(() => result.current.updateWorkspaceSettings('alpha', { permissionMode: 'standard' } as never));
    expect(toast.success).toHaveBeenCalledWith('Workspace settings saved');
    await act(() => result.current.updateWorkspacePath('alpha', '/elsewhere'));
    expect(toast.error).toHaveBeenCalledWith('Failed to update workspace folder', { description: 'disk full' });
    expect(useServerDataStore.getState().workspaces.find((w) => w.id === 'alpha')?.path).toBe('/alpha');
  });

  test('deleting the active workspace removes its sessions and activates the next one', async () => {
    const del = vi.fn().mockResolvedValue({ deletedSessions: ['s1'] });
    const current = { id: 's1', workspaceId: 'beta' } as Session;
    const { result, navigate, onSessionsDeleted, removeFromQuickConnectionsByWorkspace } = setup({ delete: del }, current);
    await act(() => result.current.deleteWorkspace('beta'));
    expect(useServerDataStore.getState().workspaces).toEqual([alpha]);
    expect(useServerDataStore.getState().activeWorkspaceId).toBe('alpha');
    expect(useSessionStore.getState().sessions.map((s) => s.id)).toEqual(['s2']);
    expect(Object.keys(useSessionContentStore.getState().messagesBySession)).toEqual(['s2']);
    expect(onSessionsDeleted).toHaveBeenCalledWith(['s1']);
    expect(removeFromQuickConnectionsByWorkspace).toHaveBeenCalledWith('beta');
    expect(navigate).toHaveBeenCalledWith({ to: '/server/$serverId/workspace', params: { serverId: 'server' } });
    expect(result.current.deletingWorkspaceId).toBeNull();
  });

  test('a failed delete keeps everything and clears the pending state', async () => {
    const del = vi.fn().mockRejectedValue(new Error('busy'));
    const { result, onSessionsDeleted } = setup({ delete: del });
    await act(() => result.current.deleteWorkspace('beta'));
    expect(useServerDataStore.getState().workspaces).toEqual([alpha, beta]);
    expect(onSessionsDeleted).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Failed to delete workspace', { description: 'busy' });
    expect(result.current.deletingWorkspaceId).toBeNull();
  });

  test('creating a folder workspace names it after the folder and makes it active', async () => {
    const created = { id: 'gamma', name: 'gamma', path: '/code/gamma' } as Workspace;
    const post = vi.fn().mockResolvedValue({ workspace: created });
    const { result } = setup({ post });
    await act(() => result.current.handleCreatePhysicalWorkspace('/code/gamma'));
    expect(post).toHaveBeenCalledWith('/workspaces', { name: 'gamma', path: '/code/gamma', isVirtual: false });
    expect(selectActiveWorkspace(useServerDataStore.getState())).toEqual(created);
    expect(localStorage.getItem('activeWorkspaceId')).toBe('gamma');
    expect(result.current.isCreatingWorkspace).toBe(false);
  });
});
