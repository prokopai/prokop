import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { resolveFilesPanelRoot } from '@/lib/sessionWorktree';
import { useSessionFilesStore, useScopedSessionFiles } from '@/stores/sessionFilesStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

beforeEach(() => {
  useSessionFilesStore.setState({ sessionFilesLayouts: {} });
  useServerDataStore.setState({ serverId: 'server', activeWorkspaceId: 'workspace' });
  useSessionBoardStore.setState({ focusedSessionId: 'a' });
});

afterEach(() => {
  cleanup();
  useSessionFilesStore.setState({ sessionFilesLayouts: {} });
  useServerDataStore.setState({ serverId: null, activeWorkspaceId: null });
  useSessionBoardStore.setState({ focusedSessionId: null });
});

test('saved roots are checked before use without losing pins during discovery', () => {
  const input = { workspacePath: '/primary', pinned: true, pinnedRoot: '/other' };
  expect(resolveFilesPanelRoot({ ...input, allowedRoots: ['/primary', '/other'] }).selectedRoot).toBe('/other');
  expect(resolveFilesPanelRoot({ ...input, allowedRoots: ['/primary'] }).selectedRoot).toBe('/primary');
  // Discovery or removal never modifies the saved selection.
  expect(input.pinnedRoot).toBe('/other');
  expect(resolveFilesPanelRoot({ ...input, allowedRoots: ['/primary', '/other'] }).selectedRoot).toBe('/other');
  expect(resolveFilesPanelRoot({ ...input, workspaceRootId: 'missing', allowedRoots: ['/primary'] }).blocked).toBe(true);
});

test('restores each session repository pin and Files tab', () => {
  const { result } = renderHook(() => ({
    root: useScopedSessionFiles((s) => s.filesPanelRoot),
    pinned: useScopedSessionFiles((s) => s.filesPanelRootPinned),
    tab: useScopedSessionFiles((s) => s.filesPanelTab),
  }));
  act(() => {
    const layout = useSessionFilesStore.getState();
    layout.setFilesPanelRoot('/other-repo');
    layout.setFilesPanelRootPinned(true);
    layout.setFilesPanelTab('branches');
  });
  expect(result.current).toEqual({ root: '/other-repo', pinned: true, tab: 'branches' });
  act(() => useSessionBoardStore.setState({ focusedSessionId: 'b' }));
  expect(result.current).toEqual({ root: null, pinned: false, tab: 'explorer' });
  act(() => useSessionFilesStore.getState().setFilesPanelRoot('/third-repo'));
  act(() => useSessionBoardStore.setState({ focusedSessionId: 'a' }));
  expect(result.current.root).toBe('/other-repo');
  expect(result.current.tab).toBe('branches');
  act(() => useSessionBoardStore.setState({ focusedSessionId: 'b' }));
  expect(result.current.root).toBe('/third-repo');
});

test('same session IDs do not share selection across servers or workspaces', () => {
  const { result } = renderHook(() => useScopedSessionFiles((s) => s.filesPanelRoot));
  act(() => useSessionFilesStore.getState().setFilesPanelRoot('/repo'));
  act(() => useServerDataStore.setState({ serverId: 'another-server' }));
  expect(result.current).toBeNull();
  act(() => useServerDataStore.setState({ serverId: 'server', activeWorkspaceId: 'another-workspace' }));
  expect(result.current).toBeNull();
  act(() => useServerDataStore.setState({ activeWorkspaceId: 'workspace' }));
  expect(result.current).toBe('/repo');
});
