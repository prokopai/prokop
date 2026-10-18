// =============================================================================
// App context decorators for components that live inside the server shell
// =============================================================================
//
//   decorators: [withSdkClient()]                 // ServerClientContext with a fake client
//   decorators: [withAppContexts()]               // commands, manager, view refs, pane registry, saved servers
//   decorators: [withAppContexts({ manager: { isCreatingWorkspace: true } })]
//
// Commands are action loggers: clicking "Archive" in a story shows
// `commands.closeSession` in the Actions panel instead of throwing.

import { createRef, useMemo, type ComponentType, type ContextType } from 'react';
import { action } from 'storybook/actions';
import type { SavedServer } from '@prokopai/sdk';
import { ServerClientProvider, type ServerClientValue } from '../../src/contexts/ServerClientContext';
import { SessionCommandsProvider, type SessionCommandsValue } from '../../src/contexts/SessionCommandsContext';
import { SessionManagerContext, type SessionManagerValue } from '../../src/contexts/SessionManagerContext';
import { ViewRefsContext, type ViewRefs } from '../../src/contexts/ViewRefsContext';
import { SessionPaneRegistryContext, type SessionPaneRegistry, type SessionPaneHandle } from '../../src/contexts/SessionPaneRegistryContext';
import { ServerContext } from '../../src/contexts/ServerContext';
import { createPreconfigList } from '../mocks';
import { createFakeSdkClient, type FakeSdkClientOptions } from './fakeSdkClient';

type ServerContextValue = NonNullable<ContextType<typeof ServerContext>>;

export const STORY_SERVER_URL = 'https://storybook.local';

export const storyServer: SavedServer = {
  id: 'story-server',
  name: 'This machine',
  url: STORY_SERVER_URL,
  token: 'story-token',
  createdAt: '2026-01-01T00:00:00.000Z',
} as SavedServer;

/** Every command logs to the Actions panel. Override the ones a story needs to do something. */
export function createStoryCommands(overrides: Partial<SessionCommandsValue> = {}): SessionCommandsValue {
  return new Proxy({ ...overrides } as SessionCommandsValue, {
    get(target, key: string) {
      if (key in target) return target[key as keyof SessionCommandsValue];
      if (key === 'then') return undefined;
      return action(`commands.${key}`);
    },
  });
}

export function createViewRefs(): ViewRefs {
  return {
    sidebarRef: createRef(),
    chatInputRef: createRef(),
    terminalPanelRef: createRef(),
    filesPanelRef: createRef(),
    scrollToBottomRef: createRef(),
    autoFollowToggleRef: createRef(),
  };
}

export function createPaneRegistry(): SessionPaneRegistry {
  const panes = new Map<string, SessionPaneHandle>();
  return {
    panes,
    register: (sessionId, handle) => { panes.set(sessionId, handle); },
    unregister: (sessionId) => { panes.delete(sessionId); },
    getHandle: (sessionId) => panes.get(sessionId),
  };
}

export function createServerContextValue(overrides: Partial<ServerContextValue> = {}): ServerContextValue {
  return {
    servers: [storyServer],
    quickConnections: [],
    isHydrated: true,
    isDiscovering: false,
    addServer: (name, url, token) => { action('servers.addServer')(name, url, token); return { ...storyServer, id: 'new-server', name, url, token: token ?? null } as SavedServer; },
    editServer: action('servers.editServer'),
    renameServer: (id, name) => { action('servers.renameServer')(id, name); return name; },
    removeServer: action('servers.removeServer'),
    addToQuickConnections: action('servers.addToQuickConnections'),
    removeFromQuickConnections: action('servers.removeFromQuickConnections'),
    removeFromQuickConnectionsByWorkspace: action('servers.removeFromQuickConnectionsByWorkspace'),
    reorderQuick: action('servers.reorderQuick'),
    ...overrides,
  };
}

export interface AppContextsOptions {
  client?: FakeSdkClientOptions | null;
  commands?: Partial<SessionCommandsValue>;
  manager?: Partial<Omit<SessionManagerValue, keyof SessionCommandsValue>>;
  server?: Partial<ServerContextValue>;
}

/** ServerClientContext with a fake, connected client. */
export function withSdkClient(options: FakeSdkClientOptions = {}) {
  return function SdkClientDecorator(Story: ComponentType) {
    const value = useMemo<ServerClientValue>(() => ({
      sdkClient: createFakeSdkClient(options),
      serverUrl: STORY_SERVER_URL,
      apiToken: 'story-token',
      connected: true,
    }), []);
    return (
      <ServerClientProvider value={value}>
        <Story />
      </ServerClientProvider>
    );
  };
}

/** Everything `ServerShell` provides, with loggers in place of real commands. */
export function withAppContexts(options: AppContextsOptions = {}) {
  return function AppContextsDecorator(Story: ComponentType) {
    const value = useMemo(() => {
      const sdkClient = options.client === null ? null : createFakeSdkClient(options.client ?? {});
      const commands = createStoryCommands(options.commands);
      const manager: SessionManagerValue = Object.assign(commands, {
        sdkClient,
        serverUrl: STORY_SERVER_URL,
        primaryPreconfigs: createPreconfigList(),
        isCreatingWorkspace: false,
        deletingWorkspaceId: null,
        isUpdatingWorkspace: {},
        ...options.manager,
      });
      const serverClient: ServerClientValue = { sdkClient, serverUrl: STORY_SERVER_URL, apiToken: 'story-token', connected: sdkClient !== null };
      return {
        commands,
        manager,
        serverClient,
        viewRefs: createViewRefs(),
        panes: createPaneRegistry(),
        servers: createServerContextValue(options.server),
      };
    }, []);
    return (
      <ServerContext.Provider value={value.servers}>
        <ServerClientProvider value={value.serverClient}>
          <SessionCommandsProvider value={value.commands}>
            <SessionManagerContext.Provider value={value.manager}>
              <ViewRefsContext.Provider value={value.viewRefs}>
                <SessionPaneRegistryContext.Provider value={value.panes}>
                  <Story />
                </SessionPaneRegistryContext.Provider>
              </ViewRefsContext.Provider>
            </SessionManagerContext.Provider>
          </SessionCommandsProvider>
        </ServerClientProvider>
      </ServerContext.Provider>
    );
  };
}
