import type { Hono } from 'hono';
import type { AgentGroupsService, GroupResult } from '@prokopai/core/application/groups/service';
import { BadRequestError, ConflictError, NotFoundError } from '@/application/http-errors';
import { validate } from './validate';
import { addGroupMemberSchema, createGroupSchema, postGroupMessageSchema, updateGroupSchema } from './schemas';

/**
 * Group chat routes: groups per workspace, membership, the thread, and the
 * person's posts. Validation and status mapping live here; every operation
 * runs on the installed group service, which also serves the member tools.
 */
function unwrap<T>(result: GroupResult<T>): T {
  if (result.ok) return result.value;
  switch (result.code) {
    case 'not_found': throw new NotFoundError(result.error);
    case 'already_member': throw new ConflictError(result.error);
    default: throw new BadRequestError(result.error);
  }
}

function integerQuery(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestError(`${name} must be a non-negative integer`);
  return parsed;
}

export function registerGroupRoutes(app: Hono, groups: AgentGroupsService): void {
  app.get('/api/workspaces/:id/groups', async (c) => c.json({ groups: await groups.list(c.req.param('id')) }));

  app.post('/api/groups', validate('json', createGroupSchema), async (c) => {
    const body = c.req.valid('json');
    const group = unwrap(await groups.create(body));
    return c.json({ group }, 201);
  });

  app.get('/api/groups/:id', async (c) => {
    const group = await groups.get(c.req.param('id'));
    if (!group) throw new NotFoundError('Group not found');
    return c.json({ group });
  });

  app.patch('/api/groups/:id', validate('json', updateGroupSchema), async (c) => {
    const group = unwrap(await groups.update(c.req.param('id'), c.req.valid('json')));
    return c.json({ group });
  });

  app.delete('/api/groups/:id', async (c) => {
    unwrap(await groups.remove(c.req.param('id')));
    return c.json({ ok: true });
  });

  app.post('/api/groups/:id/members', validate('json', addGroupMemberSchema), async (c) => {
    const group = unwrap(await groups.addMember(c.req.param('id'), c.req.valid('json').agentId));
    return c.json({ group }, 201);
  });

  app.delete('/api/groups/:id/members/:agentId', async (c) => {
    const group = unwrap(await groups.removeMember(c.req.param('id'), c.req.param('agentId')));
    return c.json({ group });
  });

  app.get('/api/groups/:id/messages', async (c) => {
    const beforeSeq = integerQuery(c.req.query('before'), 'before');
    const limit = integerQuery(c.req.query('limit'), 'limit');
    const page = unwrap(groups.listMessages(c.req.param('id'), {
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }));
    return c.json(page);
  });

  app.post('/api/groups/:id/messages', validate('json', postGroupMessageSchema), async (c) => {
    const body = c.req.valid('json');
    const posted = unwrap(await groups.postUserMessage(c.req.param('id'), body));
    return c.json(posted, 201);
  });
}
