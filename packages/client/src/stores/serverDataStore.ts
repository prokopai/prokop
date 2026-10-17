import { create } from 'zustand';
import { STORAGE_KEYS } from '@/lib/storage';
import type {
  Workspace,
  Preconfig,
  PromptInfo,
  ModelWithStatus,
  Agent,
} from '@prokopai/sdk';

interface ServerDataState {
  serverId: string | null;
  workspaces: Workspace[];
  /** The workspace itself lives in `workspaces`; read it with selectActiveWorkspace. */
  activeWorkspaceId: string | null;
  preconfigs: Preconfig[];
  prompts: PromptInfo[];
  models: ModelWithStatus[];
  defaultModel: string;
  defaultProvider: string;
  agents: Agent[];
}

interface ServerDataActions {
  hydrate: (serverId: string, data: {
    workspaces: Workspace[];
    preconfigs: Preconfig[];
    prompts: PromptInfo[];
    models: ModelWithStatus[];
    defaultModel: string;
    defaultProvider: string;
    agents: Agent[];
  }) => void;
  hydrateCritical: (serverId: string, data: {
    workspaces: Workspace[];
    preconfigs: Preconfig[];
    models: ModelWithStatus[];
    defaultModel: string;
    defaultProvider: string;
  }) => void;
  hydrateSecondary: (data: {
    prompts: PromptInfo[];
    agents: Agent[];
  }) => void;
  updateModels: (models: ModelWithStatus[], defaultModel: string, defaultProvider: string) => void;
  updatePreconfigs: (preconfigs: Preconfig[]) => void;
  updatePrompts: (prompts: PromptInfo[]) => void;
  updateAgents: (agents: Agent[]) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  /** Also remembered across reloads (localStorage). */
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  clearAll: () => void;
}

export const useServerDataStore = create<ServerDataState & ServerDataActions>((set) => ({
  serverId: null,
  workspaces: [],
  activeWorkspaceId: null,
  preconfigs: [],
  prompts: [],
  models: [],
  defaultModel: '',
  defaultProvider: '',
  agents: [],

  hydrate: (serverId, data) => set({
    serverId,
    ...data,
  }),

  hydrateCritical: (serverId, data) => set({
    serverId,
    workspaces: data.workspaces,
    preconfigs: data.preconfigs,
    models: data.models,
    defaultModel: data.defaultModel,
    defaultProvider: data.defaultProvider,
  }),

  hydrateSecondary: (data) => set({
    prompts: data.prompts,
    agents: data.agents,
  }),

  updateModels: (models, defaultModel, defaultProvider) => set({
    models,
    defaultModel,
    defaultProvider,
  }),

  updatePreconfigs: (preconfigs) => set({ preconfigs }),
  updatePrompts: (prompts) => set({ prompts }),
  updateAgents: (agents) => set({ agents }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspaceId: (workspaceId) => {
    if (workspaceId) localStorage.setItem(STORAGE_KEYS.ACTIVE_WORKSPACE_ID, workspaceId);
    else localStorage.removeItem(STORAGE_KEYS.ACTIVE_WORKSPACE_ID);
    set({ activeWorkspaceId: workspaceId });
  },

  clearAll: () => set({
    serverId: null,
    workspaces: [],
    activeWorkspaceId: null,
    preconfigs: [],
    prompts: [],
    models: [],
    defaultModel: '',
    defaultProvider: '',
    agents: [],
  }),
}));

/** The active workspace, as the same object `workspaces` holds (renames and activity apply to both). */
export function selectActiveWorkspace(state: Pick<ServerDataState, 'workspaces' | 'activeWorkspaceId'>): Workspace | null {
  return state.activeWorkspaceId
    ? state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null
    : null;
}
