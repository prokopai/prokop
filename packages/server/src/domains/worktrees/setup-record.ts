import type { WorktreeSetupCommands, WorktreeSetupState } from '@prokopai/sdk';

/** A worktree's setup as stored: one row per worktree that has a config. */
export interface WorktreeSetupRecord {
  worktreeId: string;
  configHash: string;
  portBase: number | null;
  portCount: number | null;
  state: WorktreeSetupState;
  step: string | null;
  error: string | null;
  warning: string | null;
  /** The config's commands as of the last run, so approval can show them. */
  commands: WorktreeSetupCommands;
  updatedAt: string;
}
