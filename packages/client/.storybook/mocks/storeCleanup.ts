// =============================================================================
// Store Cleanup — Reset all Zustand stores to safe defaults between stories
// =============================================================================
//
// Used as a global Storybook decorator to prevent state leaking between stories.
// Also exported as resetAllStores() for manual use in beforeEach/afterEach.

import { useSessionStore } from '@/stores/sessionStore';
import { useSessionContentStore } from '@/stores/sessionContentStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { createDefaultViewLayout, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useAskStore } from '@/stores/askStore';
import { useCompletionStore } from '@/stores/completionStore';

/**
 * Reset all stores to their initial/empty state.
 * Call between stories to prevent state leaking.
 */
export function resetAllStores(): void {
  // Session Store
  useSessionStore.setState({ sessions: [] });
  useSessionContentStore.setState({
    messagesBySession: {},
    partsBySession: {},
    queuedMessages: {},
  });

  // Server Data Store
  useServerDataStore.setState({
    serverId: null,
    workspaces: [],
    activeWorkspaceId: null,
    preconfigs: [],
    prompts: [],
    models: [],
    defaultModel: 'gpt-4o',
    defaultProvider: 'openai',
  });

  // UI Store
  useUIStore.setState({
    showSettings: false,
    chatFinishSoundEnabled: true,
    permissionSoundEnabled: true,
    filePreviewTarget: null,
  });

  // Connection Store
  useConnectionStore.setState({
    connected: false,
    authError: null,
    connectionTimedOut: false,
    retryCount: 0,
    nextRetryIn: 0,
    streamingSessionIds: new Set<string>(),
    interruptedSessions: new Set<string>(),
  });

  // Chat Layout Store
  useChatLayoutStore.setState({
    sessionFilesLayouts: {},
    filesPanelTab: 'project',
    filesPanelRoot: null,
    filesPanelRootPinned: false,
    mobileSurface: 'chat',
  });

  useDockStore.setState(useDockStore.getInitialState());
  useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileTerminalOpen: false });

  // Ask Store
  useAskStore.setState({
    pendingRequests: [],
    handlers: new Map(),
  });

  // Completion Store
  useCompletionStore.setState({
    completionState: new Map(),
  });
}
