import type { Database } from 'bun:sqlite';
import type { WorktreeSetupState } from '@prokopai/sdk';
import type {
  WorktreeSetupRecord,
  WorktreeSetupRepositoryPort,
} from '@/application/ports/worktree';

interface WorktreeSetupRow {
  worktree_id: string;
  config_hash: string;
  port_base: number | null;
  port_count: number | null;
  state: string;
  step: string | null;
  error: string | null;
  warning: string | null;
  updated_at: string;
}

function mapRow(row: WorktreeSetupRow): WorktreeSetupRecord {
  return {
    worktreeId: row.worktree_id,
    configHash: row.config_hash,
    portBase: row.port_base,
    portCount: row.port_count,
    state: row.state as WorktreeSetupState,
    step: row.step,
    error: row.error,
    warning: row.warning,
    updatedAt: row.updated_at,
  };
}

export function createWorktreeSetupRepository(
  getDatabase: () => Database,
): WorktreeSetupRepositoryPort {
  return {
    get(worktreeId) {
      const row = getDatabase().query(
        'SELECT * FROM managed_worktree_setups WHERE worktree_id = ?',
      ).get(worktreeId) as WorktreeSetupRow | null;
      return row ? mapRow(row) : null;
    },

    upsert(record) {
      getDatabase().run(
        `INSERT INTO managed_worktree_setups (
          worktree_id, config_hash, port_base, port_count, state, step, error, warning, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(worktree_id) DO UPDATE SET
          config_hash = excluded.config_hash,
          port_base = excluded.port_base,
          port_count = excluded.port_count,
          state = excluded.state,
          step = excluded.step,
          error = excluded.error,
          warning = excluded.warning,
          updated_at = excluded.updated_at`,
        [
          record.worktreeId,
          record.configHash,
          record.portBase,
          record.portCount,
          record.state,
          record.step,
          record.error,
          record.warning,
          record.updatedAt,
        ],
      );
      return record;
    },

    listByState(state) {
      return (getDatabase().query(
        'SELECT * FROM managed_worktree_setups WHERE state = ?',
      ).all(state) as WorktreeSetupRow[]).map(mapRow);
    },

    listPortBlocks() {
      return (getDatabase().query(
        'SELECT port_base, port_count FROM managed_worktree_setups WHERE port_base IS NOT NULL AND port_count IS NOT NULL',
      ).all() as Array<{ port_base: number; port_count: number }>)
        .map((row) => ({ base: row.port_base, count: row.port_count }));
    },

    isApproved(repositoryId, configHash) {
      return Boolean(getDatabase().query(
        'SELECT 1 FROM worktree_setup_approvals WHERE repository_id = ? AND config_hash = ?',
      ).get(repositoryId, configHash));
    },

    approve(repositoryId, configHash, approvedAt) {
      getDatabase().run(
        `INSERT INTO worktree_setup_approvals (repository_id, config_hash, approved_at)
         VALUES (?, ?, ?) ON CONFLICT(repository_id, config_hash) DO NOTHING`,
        [repositoryId, configHash, approvedAt],
      );
    },
  };
}
