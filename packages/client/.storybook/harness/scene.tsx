// =============================================================================
// Workspace scene: stores + contexts + router for shell-level components
// =============================================================================
//
//   decorators: workspaceScene()                               // one workspace, one open session with a conversation
//   decorators: workspaceScene({ route: STORY_ROUTES.overview })
//   decorators: workspaceScene({ messages: [], sessions: [] }) // empty workspace
//
// Returns a decorator list (innermost first): store hydration, app contexts,
// memory router. Spread it into `decorators` or append your own after it.

import type { ComponentType, ReactElement } from 'react';
import type { MessageWithParts, Session, Workspace } from '@prokopai/sdk';

/** Loose decorator shape: fits stories of components with optional props too. */
export type SceneDecorator = (Story: ComponentType) => ReactElement;
import { useServerDataStore } from '../../src/stores/serverDataStore';
import { useSessionStore } from '../../src/stores/sessionStore';
import { useSessionContentStore } from '../../src/stores/sessionContentStore';
import { useSessionBoardStore } from '../../src/stores/sessionBoardStore';
import { useConnectionStore } from '../../src/stores/connectionStore';
import { useClientIdentityStore } from '../../src/stores/clientIdentityStore';
import { createWorkspace, createSession, createTypicalConversation, createModelList, createPreconfigList } from '../mocks';
import { withAppContexts, type AppContextsOptions } from './appContexts';
import { withMemoryRouter, STORY_ROUTES } from './router';

export interface WorkspaceSceneOptions {
  workspace?: Workspace;
  /** Sessions of the workspace; the first one is open and focused unless `focused` says otherwise. */
  sessions?: Session[];
  /** Open on the board, in order. Defaults to the first session. */
  open?: string[];
  focused?: string | null;
  /** Conversation of the focused session. */
  messages?: MessageWithParts[];
  streaming?: boolean;
  connected?: boolean;
  route?: string;
  contexts?: AppContextsOptions;
}

export const SCENE_WORKSPACE = createWorkspace({ id: 'ws-scene', name: 'my-project', path: '/home/user/my-project' });
export const SCENE_SESSION = createSession({ id: 'sess-scene', workspaceId: SCENE_WORKSPACE.id, title: 'Refactor the auth module', promptTokens: 12_400, completionTokens: 3_100, totalTokens: 15_500 });

export function hydrateWorkspaceScene(options: WorkspaceSceneOptions = {}): void {
  const workspace = options.workspace ?? SCENE_WORKSPACE;
  const sessions = options.sessions ?? [SCENE_SESSION];
  const open = options.open ?? (sessions[0] ? [sessions[0].id] : []);
  const focused = options.focused === undefined ? (open[0] ?? null) : options.focused;
  const messages = options.messages ?? (focused ? createTypicalConversation(focused) : []);
  const models = createModelList();

  useClientIdentityStore.setState({ clientId: 'story-client' });
  useServerDataStore.setState({
    serverId: 'story-server',
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    preconfigs: createPreconfigList(),
    prompts: [],
    models,
    defaultModel: models[0]?.id ?? '',
    defaultProvider: models[0]?.providerId ?? '',
    agents: [],
  });
  useSessionStore.setState({ sessions });
  useSessionBoardStore.setState({ openSessionIds: open, focusedSessionId: focused });
  useConnectionStore.setState({
    connected: options.connected ?? true,
    streamingSessionIds: new Set(options.streaming && focused ? [focused] : []),
  });
  if (focused) {
    const content = useSessionContentStore.getState();
    content.setMessagesBySession({ [focused]: messages.map((item) => item.message) });
    content.setPartsBySession({ [focused]: Object.fromEntries(messages.map((item) => [item.message.id, item.parts])) });
    content.setContentMetaBySession({ [focused]: { loaded: true } as never });
  }
}

export function workspaceScene(options: WorkspaceSceneOptions = {}): SceneDecorator[] {
  function HydrateDecorator(Story: ComponentType) {
    hydrateWorkspaceScene(options);
    return <Story />;
  }
  return [
    HydrateDecorator,
    withAppContexts({ ...options.contexts, client: options.contexts?.client ?? { workspace: options.workspace ?? SCENE_WORKSPACE } }),
    withMemoryRouter(options.route ?? STORY_ROUTES.workspaceSession),
  ];
}
