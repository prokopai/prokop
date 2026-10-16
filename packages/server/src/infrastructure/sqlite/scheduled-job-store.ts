import type { ScheduledJobRepositoryPort } from '@/application/ports/scheduling';
import { createScheduledJobRepository } from './scheduled-job-repository';
import { getDatabase } from './database';

/**
 * The scheduled-job repository for adapters. Lazy, and it reads the database
 * through the accessor, so test database reconfiguration takes effect.
 */

let repository: ScheduledJobRepositoryPort | null = null;

export function getScheduledJobRepository(): ScheduledJobRepositoryPort {
  if (!repository) {
    repository = createScheduledJobRepository(() => getDatabase());
  }
  return repository;
}
