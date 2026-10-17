import type { Hono } from 'hono';
import { validate } from './validate';
import { BadRequestError, HttpError } from '@/application/http-errors';
import type { ToolsHttpApplication } from '@/application/tools';
import { setToolEnvSchema } from './schemas';

/**
 * S4 tool routes. Input validation and wire presentation stay here; every
 * operation invokes the tools application use cases. The route imports no
 * Capek compat entrypoints or configuration modules.
 */
export function registerToolRoutes(app: Hono, application: ToolsHttpApplication): void {
  // GET /api/tools - List all available tools
  app.get('/api/tools', async (c) => {
    const result = await application.listTools();
    return c.json({ tools: result.tools });
  });

  // GET /api/tools/env - List all tool env vars with status
  app.get('/api/tools/env', async (c) => {
    const result = await application.listEnv();
    if (result.kind === 'failed') {
      throw new HttpError(500, `Failed to list tool env vars: ${result.message}`, 'internal_error');
    }
    return c.json(result.status);
  });

  // PUT /api/tools/env/:key - Set a tool env var value
  app.put(
    '/api/tools/env/:key',
    validate('json', setToolEnvSchema),
    async (c) => {
      const key = c.req.param('key');
      const { value } = c.req.valid('json');

      const result = await application.setEnv(key, value);
      if (result.kind === 'invalid') {
        throw new BadRequestError(result.message);
      }
      if (result.kind === 'failed') {
        throw new HttpError(500, result.message, 'internal_error');
      }
      return c.json({ envVar: result.envVar });
    },
  );

  // DELETE /api/tools/env/:key - Clear a tool env var value
  app.delete('/api/tools/env/:key', async (c) => {
    const key = c.req.param('key');
    const result = await application.clearEnv(key);
    if (result.kind === 'invalid') {
      throw new BadRequestError(result.message);
    }
    if (result.kind === 'failed') {
      throw new HttpError(500, result.message, 'internal_error');
    }
    return c.json({ envVar: result.envVar });
  });

  // GET /api/tools/:name - Get a specific tool definition
  app.get('/api/tools/:name', async (c) => {
    const name = c.req.param('name');
    const result = await application.getTool(name);
    if (result.kind === 'missing') {
      return c.json({ error: 'not_found', message: 'Tool not found' }, 404);
    }
    return c.json({ tool: result.tool });
  });
}
