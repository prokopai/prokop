import { getScheduledJobRepository } from '@/infrastructure/sqlite/scheduled-job-store';
import type { ScheduledJobRepositoryPort } from '@/application/ports/scheduling';

/**
 * Prokop scheduled-job repository adapter: the SQLite repository, so the
 * store import stays in the adapter layer only.
 */
export function createProkopScheduledJobRepository(): ScheduledJobRepositoryPort {
  return getScheduledJobRepository();
}
