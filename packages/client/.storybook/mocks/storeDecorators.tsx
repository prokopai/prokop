// =============================================================================
// Store Decorators — Decorator-based Zustand store overrides for Storybook
// =============================================================================
//
// Usage in stories:
//   decorators: [withSessionStore({ sessions: [] })]
//   decorators: [withAllStores()]
//   decorators: [withAllStores({ connection: { connected: false } })]

import type { ComponentType } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionContentStore } from '@/stores/sessionContentStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useDockStore } from '@/stores/dockStore';
import { useSessionFilesStore } from '@/stores/sessionFilesStore';
import { useAskStore } from '@/stores/askStore';
import type { PendingAskRequest, AskHandler } from '@/stores/askStore';
import { useCompletionStore } from '@/stores/completionStore';
import type { CompletionRecord } from '@/stores/completionStore';
import {
  createWorkspace,
  createSession,
  createModelList,
  createPreconfigList,
} from './index';

// -----------------------------------------------------------------------------
// Type aliases for store state (state fields only, no actions)
// -----------------------------------------------------------------------------

type SessionStoreState = ReturnType<typeof useSessionStore.getState>;
type SessionContentStoreState = ReturnType<typeof useSessionContentStore.getState>;
type ServerDataStoreState = ReturnType<typeof useServerDataStore.getState>;
type UIStoreState = ReturnType<typeof useUIStore.getState>;
type ConnectionStoreState = ReturnType<typeof useConnectionStore.getState>;
type SessionFilesStoreState = ReturnType<typeof useSessionFilesStore.getState>;
type CompletionStoreState = ReturnType<typeof useCompletionStore.getState>;

// -----------------------------------------------------------------------------
// Session Store
// -----------------------------------------------------------------------------

interface SessionStoreDefaults {
  sessions?: SessionStoreState['sessions'];
  messagesBySession?: SessionContentStoreState['messagesBySession'];
  partsBySession?: SessionContentStoreState['partsBySession'];
  queuedMessages?: SessionContentStoreState['queuedMessages'];
}

const defaultSessionState = (): SessionStoreDefaults => {
  const workspace = createWorkspace({ name: 'my-project', path: '/home/user/my-project' });
  const session = createSession({ title: 'Storybook Session', workspaceId: workspace.id });
  return {
    sessions: [session],
    messagesBySession: {},
    partsBySession: {},
    queuedMessages: {},
  };
};

export function withSessionStore(overrides: SessionStoreDefaults = {}) {
  return function SessionStoreDecorator(Story: ComponentType) {
    const { sessions, ...content } = { ...defaultSessionState(), ...overrides };
    useSessionStore.setState({ sessions });
    useSessionContentStore.setState(content);
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Server Data Store
// -----------------------------------------------------------------------------

interface ServerDataStoreDefaults {
  serverId?: string | null;
  workspaces?: ServerDataStoreState['workspaces'];
  activeWorkspaceId?: ServerDataStoreState['activeWorkspaceId'];
  preconfigs?: ServerDataStoreState['preconfigs'];
  prompts?: ServerDataStoreState['prompts'];
  models?: ServerDataStoreState['models'];
  defaultModel?: string;
  defaultProvider?: string;
}

const defaultServerDataState = (): ServerDataStoreDefaults => {
  const workspace = createWorkspace({ name: 'my-project', path: '/home/user/my-project' });
  return {
    serverId: 'mock-server-id',
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    preconfigs: createPreconfigList(),
    prompts: [],
    models: createModelList(),
    defaultModel: 'claude-3.5-sonnet',
    defaultProvider: 'anthropic',
  };
};

export function withServerDataStore(overrides: ServerDataStoreDefaults = {}) {
  return function ServerDataStoreDecorator(Story: ComponentType) {
    useServerDataStore.setState({ ...defaultServerDataState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// UI Store
// -----------------------------------------------------------------------------

interface UIStoreDefaults {
  showSettings?: boolean;
  showTools?: boolean;
  showMCPDialog?: boolean;
  showWorkspacePermissions?: boolean;
  chatFinishSoundEnabled?: boolean;
  permissionSoundEnabled?: boolean;
  filePreviewTarget?: UIStoreState['filePreviewTarget'];
}

const defaultUIState = (): UIStoreDefaults => ({
  showSettings: false,
  showTools: false,
  showMCPDialog: false,
  showWorkspacePermissions: false,
  chatFinishSoundEnabled: true,
  permissionSoundEnabled: true,
  filePreviewTarget: null,
});

export function withUIStore(overrides: UIStoreDefaults = {}) {
  return function UIStoreDecorator(Story: ComponentType) {
    useUIStore.setState({ ...defaultUIState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Connection Store
// -----------------------------------------------------------------------------

interface ConnectionStoreDefaults {
  connected?: ConnectionStoreState['connected'];
  authError?: string | null;
  connectionTimedOut?: boolean;
  retryCount?: number;
  nextRetryIn?: number;
  streamingSessionIds?: Set<string>;
  interruptedSessions?: Set<string>;
}

const defaultConnectionState = (): ConnectionStoreDefaults => ({
  connected: true,
  authError: null,
  connectionTimedOut: false,
  retryCount: 0,
  nextRetryIn: 0,
  streamingSessionIds: new Set<string>(),
  interruptedSessions: new Set<string>(),
});

export function withConnectionStore(overrides: ConnectionStoreDefaults = {}) {
  return function ConnectionStoreDecorator(Story: ComponentType) {
    useConnectionStore.setState({ ...defaultConnectionState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Session Files Store
// -----------------------------------------------------------------------------

interface SessionFilesStoreDefaults {
  filesPanelTab?: SessionFilesStoreState['filesPanelTab'];
}

const defaultSessionFilesState = (): SessionFilesStoreDefaults => ({
  filesPanelTab: 'explorer',
});

export function withSessionFilesStore(overrides: SessionFilesStoreDefaults = {}) {
  return function SessionFilesStoreDecorator(Story: ComponentType) {
    useSessionFilesStore.setState({ ...defaultSessionFilesState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Ask Store
// -----------------------------------------------------------------------------

interface AskStoreDefaults {
  pendingRequests?: PendingAskRequest[];
  handlers?: Map<string, AskHandler[]>;
}

const defaultAskState = (): AskStoreDefaults => ({
  pendingRequests: [],
  handlers: new Map(),
});

export function withAskStore(overrides: AskStoreDefaults = {}) {
  return function AskStoreDecorator(Story: ComponentType) {
    useAskStore.setState({ ...defaultAskState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Completion Store
// -----------------------------------------------------------------------------

interface CompletionStoreDefaults {
  completionState?: CompletionStoreState['completionState'];
}

const defaultCompletionState = (): CompletionStoreDefaults => ({
  completionState: new Map<string, CompletionRecord>(),
});

export function withCompletionStore(overrides: CompletionStoreDefaults = {}) {
  return function CompletionStoreDecorator(Story: ComponentType) {
    useCompletionStore.setState({ ...defaultCompletionState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Convenience: All Stores Combined
// -----------------------------------------------------------------------------

export interface AllStoresOverrides {
  session?: SessionStoreDefaults;
  serverData?: ServerDataStoreDefaults;
  ui?: UIStoreDefaults;
  connection?: ConnectionStoreDefaults;
  sessionFiles?: SessionFilesStoreDefaults;
  docks?: ReturnType<typeof useDockStore.getState>['docks'];
  ask?: AskStoreDefaults;
  completion?: CompletionStoreDefaults;
}

export function withAllStores(overrides: AllStoresOverrides = {}) {
  return function AllStoresDecorator(Story: ComponentType) {
    // Set each store's state — order matters (server data before session)
    useServerDataStore.setState({ ...defaultServerDataState(), ...overrides.serverData });
    useSessionStore.setState({ ...defaultSessionState(), ...overrides.session });
    useUIStore.setState({ ...defaultUIState(), ...overrides.ui });
    useConnectionStore.setState({ ...defaultConnectionState(), ...overrides.connection });
    useSessionFilesStore.setState({ ...defaultSessionFilesState(), ...overrides.sessionFiles });
    useDockStore.setState({ docks: overrides.docks ?? useDockStore.getInitialState().docks });
    useAskStore.setState({ ...defaultAskState(), ...overrides.ask });
    useCompletionStore.setState({ ...defaultCompletionState(), ...overrides.completion });
    return <Story />;
  };
}
