import { create } from 'zustand';
import { isWorkspaceOrder, loadWorkspaceOrder, WORKSPACE_ORDER_KEY, type WorkspaceOrder } from '@/lib/workspaceOrder';
import type { PermissionRiskLevel, ScheduledJob } from '@prokopai/sdk';
import type { UseBoundStore, StoreApi } from 'zustand';

// --- Configuration Section (deep-linking) ---
export type ConfigurationSection =
  | 'mcp'
  | 'workspace-general'
  | 'workspace-sessions' // Legacy selection opens General.
  | 'workspace-mcp'
  | 'workspace-permissions'
  | 'workspace-paths' // Legacy selection opens General.
  | 'workspace-learning'
  | 'workspace-agentTools' // Legacy selection opens Memory & Learning.
  // Preferences
  | 'system'
  | 'appearance'
  | 'notifications'
  | 'keybinds'
  // Server (shared across harnesses; prompts are client-level shortcuts)
  | 'harnesses'
  | 'devices'
  | 'usage'
  | 'preconfigs'
  | 'prompts'
  // Prokop runtime
  | 'providers-models'
  | 'response-formats';

// --- Default File Open Mode ---
export type DefaultFileOpenMode = 'preview' | 'edit';

/** What a message sent while the agent works does: enter the running turn, or wait for it to end. */
export type FollowUpMode = 'steer' | 'queue';

interface ConfigurationSectionState {
  configurationSection: ConfigurationSection;
}

interface ConfigurationSectionActions {
  setConfigurationSection: (section: ConfigurationSection) => void;
}

// --- File Preview ---
export interface FilePreviewTarget {
  workspaceId: string;
  path: string;
  name: string;
  root?: string;
  /** Allow an absolute path outside the workspace: set for files an agent links in chat. */
  anywhere?: boolean;
}

interface FilePreviewState {
  filePreviewTarget: FilePreviewTarget | null;
}

interface FilePreviewActions {
  openFilePreview: (target: FilePreviewTarget) => void;
  closeFilePreview: () => void;
}

// --- Scheduler Modal ---
interface SchedulerModalState {
  showSchedulerJob: boolean;
  editingSchedulerJob: ScheduledJob | null;
}

interface SchedulerModalActions {
  setShowSchedulerJob: (show: boolean, job?: ScheduledJob | null) => void;
}

// --- Settings ---
const CHAT_FINISH_SOUND_KEY = 'prokopai_sound_chat_finish_enabled';
const PERMISSION_SOUND_KEY = 'prokopai_sound_permission_enabled';
const DEFAULT_FILE_OPEN_MODE_KEY = 'prokopai_default_file_open_mode';
const FOLLOW_UP_MODE_KEY = 'prokopai_follow_up_mode';

const getStoredBoolean = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  return stored !== null ? stored === 'true' : fallback;
};

function getStoredFileOpenMode(): DefaultFileOpenMode {
  if (typeof window === 'undefined') return 'preview';
  const stored = localStorage.getItem(DEFAULT_FILE_OPEN_MODE_KEY);
  return stored === 'edit' ? 'edit' : 'preview';
}

function getStoredFollowUpMode(): FollowUpMode {
  if (typeof window === 'undefined') return 'steer';
  return localStorage.getItem(FOLLOW_UP_MODE_KEY) === 'queue' ? 'queue' : 'steer';
}

interface SettingsState {
  workspaceOrder: WorkspaceOrder;
  chatFinishSoundEnabled: boolean;
  permissionSoundEnabled: boolean;
  defaultFileOpenMode: DefaultFileOpenMode;
  followUpMode: FollowUpMode;
}

interface SettingsActions {
  setWorkspaceOrder: (order: WorkspaceOrder) => void;
  setChatFinishSoundEnabled: (enabled: boolean) => void;
  setPermissionSoundEnabled: (enabled: boolean) => void;
  setDefaultFileOpenMode: (mode: DefaultFileOpenMode) => void;
  setFollowUpMode: (mode: FollowUpMode) => void;
}

// --- Auto-Approve Severity ---
const AUTO_APPROVE_KEY = 'prokopai_auto_approve_severity';

function loadAutoApproveMap(): Record<string, PermissionRiskLevel | 'off'> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(AUTO_APPROVE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function persistAutoApproveMap(map: Record<string, PermissionRiskLevel | 'off'>): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(AUTO_APPROVE_KEY, JSON.stringify(map));
  }
}

interface AutoApproveState {
  autoApproveBySession: Record<string, PermissionRiskLevel | 'off'>;
}

interface AutoApproveActions {
  setAutoApproveMaxSeverity: (sessionId: string, level: PermissionRiskLevel | 'off') => void;
  getAutoApproveMaxSeverity: (sessionId: string) => PermissionRiskLevel | 'off' | null;
}

// --- Recent models ---
// The last few models picked in a workspace, across harnesses, so the model
// picker can put them first. Identity only; names come from the live catalog.
const RECENT_MODELS_KEY = 'prokopai_recent_models';
const RECENT_MODELS_LIMIT = 3;

export interface RecentModelRef {
  harness: 'prokop' | 'claude-cli' | 'codex-cli';
  /** Unique within the harness: `provider:model` for Prokop, the model id otherwise. */
  key: string;
}

function loadRecentModels(): Record<string, RecentModelRef[]> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(RECENT_MODELS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

interface RecentModelsState {
  recentModelsByWorkspace: Record<string, RecentModelRef[]>;
}

interface RecentModelsActions {
  pushRecentModel: (workspaceId: string, ref: RecentModelRef) => void;
}

// --- Combined Store ---
type UIStore = ConfigurationSectionState & ConfigurationSectionActions & SettingsState & SettingsActions & FilePreviewState & FilePreviewActions & AutoApproveState & AutoApproveActions & RecentModelsState & RecentModelsActions & SchedulerModalState & SchedulerModalActions;

export const useUIStore: UseBoundStore<StoreApi<UIStore>> = create<UIStore>((set) => ({
  // --- Configuration Section ---
  configurationSection: 'appearance',
  setConfigurationSection: (section) => set({ configurationSection: section }),

  // --- Settings ---
  chatFinishSoundEnabled: getStoredBoolean(CHAT_FINISH_SOUND_KEY, true),
  permissionSoundEnabled: getStoredBoolean(PERMISSION_SOUND_KEY, true),
  defaultFileOpenMode: getStoredFileOpenMode(),
  followUpMode: getStoredFollowUpMode(),
  workspaceOrder: loadWorkspaceOrder(),
  setWorkspaceOrder: (order) => {
    if (!isWorkspaceOrder(order)) return;
    try { localStorage.setItem(WORKSPACE_ORDER_KEY, order); } catch { /* Storage may be blocked. */ }
    set({ workspaceOrder: order });
  },

  setChatFinishSoundEnabled: (enabled) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CHAT_FINISH_SOUND_KEY, String(enabled));
    }
    set({ chatFinishSoundEnabled: enabled });
  },
  setPermissionSoundEnabled: (enabled) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(PERMISSION_SOUND_KEY, String(enabled));
    }
    set({ permissionSoundEnabled: enabled });
  },
  setDefaultFileOpenMode: (mode) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEFAULT_FILE_OPEN_MODE_KEY, mode);
    }
    set({ defaultFileOpenMode: mode });
  },
  setFollowUpMode: (mode) => {
    try { localStorage.setItem(FOLLOW_UP_MODE_KEY, mode); } catch { /* Storage may be blocked. */ }
    set({ followUpMode: mode });
  },

  // --- File Preview ---
  filePreviewTarget: null,

  openFilePreview: (target) => set({ filePreviewTarget: target }),
  closeFilePreview: () => set({ filePreviewTarget: null }),

  // --- Recent models ---
  recentModelsByWorkspace: loadRecentModels(),
  pushRecentModel: (workspaceId, ref) =>
    set((state) => {
      const current = state.recentModelsByWorkspace[workspaceId] ?? [];
      const rest = current.filter((r) => !(r.harness === ref.harness && r.key === ref.key));
      const next = { ...state.recentModelsByWorkspace, [workspaceId]: [ref, ...rest].slice(0, RECENT_MODELS_LIMIT) };
      try { localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next)); } catch { /* Storage may be blocked. */ }
      return { recentModelsByWorkspace: next };
    }),

  // --- Auto-Approve Severity ---
  autoApproveBySession: loadAutoApproveMap(),

  setAutoApproveMaxSeverity: (sessionId, level) =>
    set((state) => {
      const next = { ...state.autoApproveBySession };
      next[sessionId] = level;
      persistAutoApproveMap(next);
      return { autoApproveBySession: next };
    }),

  getAutoApproveMaxSeverity: (sessionId): PermissionRiskLevel | 'off' | null => {
    return useUIStore.getState().autoApproveBySession[sessionId] ?? null;
  },

  // --- Scheduler Modal ---
  showSchedulerJob: false,
  editingSchedulerJob: null,

  setShowSchedulerJob: (show, job = null) => set({ showSchedulerJob: show, editingSchedulerJob: show ? job : null }),
}));
