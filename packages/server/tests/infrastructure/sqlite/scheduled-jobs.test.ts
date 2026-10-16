import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { initializeSchema } from '@/infrastructure/sqlite/database';
import { seedWorkspace } from '#tests/seed';
import { getScheduledJobRepository } from '@/infrastructure/sqlite/scheduled-job-store';

const scheduledJobs = getScheduledJobRepository;

describe('scheduled-jobs store', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  describe('migration', () => {
    test('adds notifications_enabled to existing jobs with notifications disabled', () => {
      const legacyDb = new Database(':memory:');
      legacyDb.run(`
        CREATE TABLE scheduled_jobs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          schedule_kind TEXT NOT NULL,
          schedule_config TEXT NOT NULL,
          schedule_display TEXT NOT NULL,
          state TEXT NOT NULL,
          repeat_limit INTEGER,
          run_count INTEGER NOT NULL DEFAULT 0,
          next_run_at INTEGER,
          last_run_at INTEGER,
          last_run_session_id TEXT,
          last_error TEXT,
          reuse_session INTEGER NOT NULL DEFAULT 0,
          include_history INTEGER NOT NULL DEFAULT 0,
          preconfig_id TEXT,
          origin_session_id TEXT,
          auto_approve_severity TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      legacyDb.run(
        `INSERT INTO scheduled_jobs (
          id, workspace_id, name, prompt, schedule_kind, schedule_config,
          schedule_display, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'legacy-job',
          'ws1',
          'Legacy job',
          'Run',
          'interval',
          JSON.stringify({ type: 'interval', intervalMinutes: 60 }),
          'Every 60m',
          'active',
          Date.now(),
          Date.now(),
        ],
      );

      initializeSchema(legacyDb);

      const row = legacyDb
        .query('SELECT notifications_enabled FROM scheduled_jobs WHERE id = ?')
        .get('legacy-job') as { notifications_enabled: number };
      expect(row.notifications_enabled).toBe(0);
      legacyDb.close();
    });
  });

  describe('createScheduledJob', () => {
    test('creates a job with all fields and reads it back', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      const job = scheduledJobs().create('ws1', {
        name: 'Daily reflection',
        prompt: 'Review recent work and extract lessons',
        scheduleKind: 'daily',
        scheduleConfig: { type: 'daily', time: '09:00' },
        repeatLimit: 10,
        reuseSession: true,
        includeHistory: false,
        preconfigId: 'agent-1',
        originSessionId: 'session-1',
        permissionMode: 'standard',
        notificationsEnabled: true,
      });

      expect(job.id).toBeDefined();
      expect(job.workspaceId).toBe('ws1');
      expect(job.name).toBe('Daily reflection');
      expect(job.prompt).toBe('Review recent work and extract lessons');
      expect(job.scheduleKind).toBe('daily');
      expect(job.scheduleConfig).toEqual({ type: 'daily', time: '09:00' });
      expect(job.scheduleDisplay).toBe('Daily at 09:00');
      expect(job.state).toBe('active');
      expect(job.repeatLimit).toBe(10);
      expect(job.runCount).toBe(0);
      expect(job.nextRunAt).not.toBeNull();
      expect(job.lastRunAt).toBeNull();
      expect(job.lastRunSessionId).toBeNull();
      expect(job.lastError).toBeNull();
      expect(job.reuseSession).toBe(true);
      expect(job.includeHistory).toBe(false);
      expect(job.preconfigId).toBe('agent-1');
      expect(job.originSessionId).toBe('session-1');
      expect(job.permissionMode).toBe('standard');
      expect(job.notificationsEnabled).toBe(true);
      expect(job.createdAt).toBeDefined();
      expect(job.updatedAt).toBeDefined();
    });

    test('creates a job with defaults (nulls and booleans)', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      const job = scheduledJobs().create('ws1', {
        name: 'Simple job',
        prompt: 'Do something',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
      });

      expect(job.repeatLimit).toBeNull();
      expect(job.reuseSession).toBe(false);
      expect(job.includeHistory).toBe(false);
      expect(job.preconfigId).toBeNull();
      expect(job.originSessionId).toBeNull();
      expect(job.permissionMode).toBeNull();
      expect(job.notificationsEnabled).toBe(false);
    });

    test('creates a job with notificationsEnabled true', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      const job = scheduledJobs().create('ws1', {
        name: 'Notify job',
        prompt: 'Do something',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
        notificationsEnabled: true,
      });

      expect(job.notificationsEnabled).toBe(true);
    });

    test('computes nextRunAt for interval schedule', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      const job = scheduledJobs().create('ws1', {
        name: 'Every 2h',
        prompt: 'Run',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 120 },
      });

      const expected = Date.now() + 120 * 60_000;
      const actual = new Date(job.nextRunAt!).getTime();
      expect(Math.abs(actual - expected)).toBeLessThan(5000);
    });

    test('computes nextRunAt for weekly schedule', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      const job = scheduledJobs().create('ws1', {
        name: 'Weekdays',
        prompt: 'Run',
        scheduleKind: 'weekly',
        scheduleConfig: { type: 'weekly', days: [1, 2, 3, 4, 5], time: '17:00' },
      });

      expect(job.nextRunAt).not.toBeNull();
      expect(job.scheduleDisplay).toBe('Weekdays at 17:00');
    });
  });

  describe('getScheduledJob', () => {
    test('returns null for non-existent job', () => {
      expect(scheduledJobs().get('does-not-exist')).toBeNull();
    });
  });

  describe('listScheduledJobs', () => {
    test('returns all jobs for a workspace', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      const job1 = scheduledJobs().create('ws1', {
        name: 'First',
        prompt: 'A',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      const job2 = scheduledJobs().create('ws1', {
        name: 'Second',
        prompt: 'B',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      const jobs = scheduledJobs().list('ws1');
      expect(jobs).toHaveLength(2);
      expect(jobs.some(j => j.id === job1.id)).toBe(true);
      expect(jobs.some(j => j.id === job2.id)).toBe(true);
    });

    test('only returns jobs for the specified workspace', () => {
      seedWorkspace({ id: 'ws1', name: 'A', path: '/a' });
      seedWorkspace({ id: 'ws2', name: 'B', path: '/b' });

      scheduledJobs().create('ws1', {
        name: 'Job A',
        prompt: 'A',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      scheduledJobs().create('ws2', {
        name: 'Job B',
        prompt: 'B',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      expect(scheduledJobs().list('ws1')).toHaveLength(1);
      expect(scheduledJobs().list('ws2')).toHaveLength(1);
    });
  });

  describe('updateScheduledJob', () => {
    test('updates name and prompt', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'Old',
        prompt: 'Old prompt',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      const updated = scheduledJobs().update(job.id, {
        name: 'New name',
        prompt: 'New prompt',
      });

      expect(updated!.name).toBe('New name');
      expect(updated!.prompt).toBe('New prompt');
    });

    test('updates schedule and recomputes nextRunAt', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'Job',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      const originalNextRun = job.nextRunAt;

      const updated = scheduledJobs().update(job.id, {
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
      });

      expect(updated!.scheduleDisplay).toBe('Every 30m');
      // nextRunAt should be recomputed for an active job
      expect(updated!.nextRunAt).not.toBeNull();
      expect(updated!.nextRunAt).not.toBe(originalNextRun);
    });

    test('pausing sets nextRunAt to null, resuming recomputes it', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'Job',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      const paused = scheduledJobs().update(job.id, { state: 'paused' });
      expect(paused!.state).toBe('paused');
      expect(paused!.nextRunAt).toBeNull();

      const resumed = scheduledJobs().update(job.id, { state: 'active' });
      expect(resumed!.state).toBe('active');
      expect(resumed!.nextRunAt).not.toBeNull();
    });

    test('returns null for non-existent job', () => {
      expect(scheduledJobs().update('nope', { name: 'x' })).toBeNull();
    });

    test('toggles notificationsEnabled in both directions', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      expect(job.notificationsEnabled).toBe(false);

      const enabled = scheduledJobs().update(job.id, { notificationsEnabled: true });
      expect(enabled!.notificationsEnabled).toBe(true);

      const disabled = scheduledJobs().update(job.id, { notificationsEnabled: false });
      expect(disabled!.notificationsEnabled).toBe(false);
    });

    test('unrelated update preserves notificationsEnabled', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        notificationsEnabled: true,
      });

      const updated = scheduledJobs().update(job.id, { name: 'Renamed' });
      expect(updated!.notificationsEnabled).toBe(true);
    });
  });

  describe('deleteScheduledJob', () => {
    test('deletes a job and returns true', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      expect(scheduledJobs().delete(job.id)).toBe(true);
      expect(scheduledJobs().get(job.id)).toBeNull();
    });

    test('returns false for non-existent job', () => {
      expect(scheduledJobs().delete('nope')).toBe(false);
    });
  });

  describe('deleteScheduledJobsByWorkspace', () => {
    test('deletes all jobs in a workspace', () => {
      seedWorkspace({ id: 'ws1', name: 'A', path: '/a' });
      seedWorkspace({ id: 'ws2', name: 'B', path: '/b' });

      scheduledJobs().create('ws1', { name: 'J1', prompt: 'P', scheduleKind: 'interval', scheduleConfig: { type: 'interval', intervalMinutes: 60 } });
      scheduledJobs().create('ws1', { name: 'J2', prompt: 'P', scheduleKind: 'interval', scheduleConfig: { type: 'interval', intervalMinutes: 60 } });
      scheduledJobs().create('ws2', { name: 'J3', prompt: 'P', scheduleKind: 'interval', scheduleConfig: { type: 'interval', intervalMinutes: 60 } });

      expect(scheduledJobs().deleteByWorkspace('ws1')).toBe(2);
      expect(scheduledJobs().list('ws1')).toHaveLength(0);
      expect(scheduledJobs().list('ws2')).toHaveLength(1);
    });
  });

  describe('getDueScheduledJobs', () => {
    test('returns active jobs with nextRunAt <= now', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      const job = scheduledJobs().create('ws1', {
        name: 'Due',
        prompt: 'P',
        scheduleKind: 'once',
        scheduleConfig: { type: 'once', runAt: new Date(Date.now() - 1000).toISOString() },
      });

      const due = scheduledJobs().getDue(Date.now());
      expect(due).toHaveLength(1);
      expect(due[0].id).toBe(job.id);
    });

    test('excludes paused and completed jobs', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      scheduledJobs().create('ws1', {
        name: 'Due',
        prompt: 'P',
        scheduleKind: 'once',
        scheduleConfig: { type: 'once', runAt: new Date(Date.now() - 1000).toISOString() },
      });

      // Pause it
      const jobs = scheduledJobs().list('ws1');
      scheduledJobs().update(jobs[0].id, { state: 'paused' });

      expect(scheduledJobs().getDue(Date.now())).toHaveLength(0);
    });
  });

  describe('markScheduledJobRun', () => {
    test('increments runCount and sets lastRunAt/sessionId', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      scheduledJobs().markRun(job.id, 'session-run-1');

      const updated = scheduledJobs().get(job.id)!;
      expect(updated.runCount).toBe(1);
      expect(updated.lastRunAt).not.toBeNull();
      expect(updated.lastRunSessionId).toBe('session-run-1');
      expect(updated.lastError).toBeNull();
    });
  });

  describe('markScheduledJobError', () => {
    test('sets lastError without changing runCount', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      scheduledJobs().markError(job.id, 'Something went wrong');

      const updated = scheduledJobs().get(job.id)!;
      expect(updated.runCount).toBe(0);
      expect(updated.lastError).toBe('Something went wrong');
    });
  });

  describe('advanceScheduledJob', () => {
    test('completes a one-shot job after first run', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'Once',
        prompt: 'P',
        scheduleKind: 'once',
        scheduleConfig: { type: 'once', runAt: new Date(Date.now() - 1000).toISOString() },
      });

      scheduledJobs().markRun(job.id, 's1');
      scheduledJobs().advance(job.id);

      const updated = scheduledJobs().get(job.id)!;
      expect(updated.state).toBe('completed');
      expect(updated.nextRunAt).toBeNull();
    });

    test('completes a recurring job when repeatLimit reached', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'Limited',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        repeatLimit: 3,
      });

      // Run 1: runCount becomes 1, advance checks 1+1=2 >= 3? No → stays active
      scheduledJobs().markRun(job.id, 's1');
      scheduledJobs().advance(job.id);
      expect(scheduledJobs().get(job.id)!.state).toBe('active');

      // Run 2: runCount becomes 2, advance checks 2+1=3 >= 3? Yes → completes
      scheduledJobs().markRun(job.id, 's2');
      scheduledJobs().advance(job.id);
      expect(scheduledJobs().get(job.id)!.state).toBe('completed');
      expect(scheduledJobs().get(job.id)!.nextRunAt).toBeNull();
    });

    test('schedules next run for recurring job under repeatLimit', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'Recurring',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      scheduledJobs().markRun(job.id, 's1');
      scheduledJobs().advance(job.id);

      const updated = scheduledJobs().get(job.id)!;
      expect(updated.state).toBe('active');
      expect(updated.nextRunAt).not.toBeNull();
    });
  });

  describe('markScheduledJobCompleted', () => {
    test('sets state to completed and clears nextRunAt', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = scheduledJobs().create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      scheduledJobs().markCompleted(job.id);

      const updated = scheduledJobs().get(job.id)!;
      expect(updated.state).toBe('completed');
      expect(updated.nextRunAt).toBeNull();
    });
  });
});
