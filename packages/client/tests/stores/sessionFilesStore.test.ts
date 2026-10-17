import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { useSessionFilesStore } from '@/stores/sessionFilesStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

describe('sessionFilesStore', () => {
  beforeEach(() => {
    useSessionFilesStore.setState(useSessionFilesStore.getInitialState());
    useServerDataStore.setState({ serverId: null, activeWorkspaceId: null });
    useSessionBoardStore.setState({ focusedSessionId: null });
  });
  afterEach(() => {
    useSessionFilesStore.setState(useSessionFilesStore.getInitialState());
  });

  test('stores the repository view by its view id and falls back to the global slot without a focused session', () => {
    expect(useSessionFilesStore.getState().filesPanelTab).toBe('explorer');
    useSessionFilesStore.getState().setFilesPanelTab('changes');
    expect(useSessionFilesStore.getState().filesPanelTab).toBe('changes');
    expect(useSessionFilesStore.getState().sessionFilesLayouts).toEqual({});
  });
});
