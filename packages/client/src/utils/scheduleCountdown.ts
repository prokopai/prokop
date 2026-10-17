import type { ScheduledJob } from '@prokopai/sdk';

export function formatLastRun(job: ScheduledJob): string {
  if (!job.lastRunAt) return 'Never';
  const d = new Date(job.lastRunAt);
  return d.toLocaleString();
}
