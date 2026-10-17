import type { Hono } from 'hono';
import type { MaintenanceApplication } from '@/application/ports/maintenance';
import { HttpError } from '@/application/http-errors';

function failed(action: string, err: unknown): HttpError {
  return new HttpError(500, `${action} failed: ${err instanceof Error ? err.message : String(err)}`, 'internal_error');
}

export function registerMaintenanceRoutes(app: Hono, maintenance: MaintenanceApplication): void {
  // GET /api/maintenance/db-stats - Database size and page statistics
  app.get('/api/maintenance/db-stats', (c) => {
    try {
      return c.json(maintenance.vacuum({ dryRun: true }));
    } catch (err: unknown) {
      throw failed('Database stats', err);
    }
  });

  // POST /api/maintenance/vacuum - Reclaim free space in the database
  app.post('/api/maintenance/vacuum', (c) => {
    try {
      return c.json({ success: true, ...maintenance.vacuum() });
    } catch (err: unknown) {
      throw failed('Vacuum', err);
    }
  });

  // POST /api/maintenance/cleanup - Remove orphaned data
  app.post('/api/maintenance/cleanup', (c) => {
    try {
      return c.json({ success: true, stats: maintenance.cleanup() });
    } catch (err: unknown) {
      throw failed('Cleanup', err);
    }
  });
}
