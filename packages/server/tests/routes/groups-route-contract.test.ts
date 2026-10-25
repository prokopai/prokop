import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AgentGroup } from '@prokopai/sdk';
import type { AgentGroupsService, GroupResult } from '@prokopai/core/application/groups/service';
import { registerGroupRoutes } from '@/transport/http/routes/groups';
import { HttpError } from '@/application/http-errors';

const GROUP: AgentGroup = {
  id: 'g1', workspaceId: 'ws1', name: 'API work', defaultAgentId: 'implementer', permissionMode: 'standard',
  members: [{ agentId: 'implementer', name: 'Implementer', sessionId: 's1', cursorSeq: 0, joinedAt: 't' }],
  createdAt: 't', updatedAt: 't',
};
const ok = <T,>(value: T): GroupResult<T> => ({ ok: true, value });

function makeService(overrides: Partial<AgentGroupsService> = {}): { service: AgentGroupsService; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record = <T,>(name: string, value: T) => (...args: unknown[]) => { calls.push([name, ...args]); return value; };
  const service: AgentGroupsService = {
    create: record('create', Promise.resolve(ok(GROUP))),
    get: record('get', Promise.resolve(GROUP)),
    list: record('list', Promise.resolve([GROUP])),
    update: record('update', Promise.resolve(ok(GROUP))),
    addMember: record('addMember', Promise.resolve(ok(GROUP))),
    removeMember: record('removeMember', Promise.resolve(ok(GROUP))),
    remove: record('remove', Promise.resolve(ok({ id: 'g1', workspaceId: 'ws1' }))),
    postUserMessage: record('postUserMessage', Promise.resolve(ok({ message: { id: 'm1' } as never, woken: ['implementer'] }))),
    listMessages: record('listMessages', ok({ messages: [], hasMore: false })),
    memberOf: record('memberOf', Promise.resolve(null)),
    history: record('history', Promise.resolve(ok({ group: 'API work', messages: [], has_more: false }))),
    handoff: record('handoff', Promise.resolve(ok({ target: 'reviewer', hop: 1, seq: 2, note: '' }))),
    mirrorFinishedTurn: record('mirrorFinishedTurn', Promise.resolve('skipped' as const)),
    ...overrides,
  };
  return { service, calls };
}

function makeApp(service: AgentGroupsService): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status as never);
    return c.json({ error: 'Internal Server Error', message: err instanceof Error ? err.message : String(err) }, 500 as never);
  });
  registerGroupRoutes(app, service);
  return app;
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('group route contract', () => {
  test('groups are listed per workspace, created, read, patched and deleted through the service', async () => {
    const { service, calls } = makeService();
    const app = makeApp(service);
    expect(await (await app.request('/api/workspaces/ws1/groups')).json()).toEqual({ groups: [GROUP] });
    const created = await app.request('/api/groups', json({ workspaceId: 'ws1', name: 'API work', memberAgentIds: ['implementer', 'reviewer'] }));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ group: GROUP });
    expect(await (await app.request('/api/groups/g1')).json()).toEqual({ group: GROUP });
    expect((await app.request('/api/groups/g1', { ...json({ name: 'Renamed', permissionMode: 'full' }), method: 'PATCH' })).status).toBe(200);
    expect((await app.request('/api/groups/g1', { ...json({ permissionMode: 'yolo' }), method: 'PATCH' })).status).toBe(400);
    expect((await app.request('/api/groups/g1', { method: 'DELETE' })).status).toBe(200);
    expect((await app.request('/api/groups/g1/members', json({ agentId: 'reviewer' }))).status).toBe(201);
    expect((await app.request('/api/groups/g1/members/reviewer', { method: 'DELETE' })).status).toBe(200);
    expect(calls.map((call) => call[0])).toEqual(['list', 'create', 'get', 'update', 'remove', 'addMember', 'removeMember']);
    expect(calls[1]).toEqual(['create', { workspaceId: 'ws1', name: 'API work', memberAgentIds: ['implementer', 'reviewer'] }]);
    expect(calls[3]).toEqual(['update', 'g1', { name: 'Renamed', permissionMode: 'full' }]);
    expect(calls[6]).toEqual(['removeMember', 'g1', 'reviewer']);
  });

  test('a post returns the message and who was woken; the thread pages by seq', async () => {
    const { service, calls } = makeService();
    const app = makeApp(service);
    const posted = await app.request('/api/groups/g1/messages', json({ text: '@Reviewer check it', mentions: ['reviewer'] }));
    expect(posted.status).toBe(201);
    expect(await posted.json()).toEqual({ message: { id: 'm1' }, woken: ['implementer'] });
    expect(calls[0]).toEqual(['postUserMessage', 'g1', { text: '@Reviewer check it', mentions: ['reviewer'] }]);
    expect(await (await app.request('/api/groups/g1/messages?before=12&limit=5')).json()).toEqual({ messages: [], hasMore: false });
    expect(calls[1]).toEqual(['listMessages', 'g1', { beforeSeq: 12, limit: 5 }]);
    expect((await app.request('/api/groups/g1/messages?before=x')).status).toBe(400);
    expect((await app.request('/api/groups/g1/messages', json({ text: '' }))).status).toBe(400);
    expect((await app.request('/api/groups', json({ workspaceId: 'ws1', name: 'x', memberAgentIds: [], extra: true }))).status).toBe(400);
  });

  test('service refusals map to 404, 409 and 400 with the service message', async () => {
    const refuse = (code: Parameters<typeof makeService>[0] extends infer _ ? 'not_found' | 'already_member' | 'too_few_members' : never, error: string) =>
      Promise.resolve({ ok: false as const, code, error });
    const { service } = makeService({
      get: async () => null,
      update: () => refuse('not_found', 'Group not found'),
      addMember: () => refuse('already_member', 'reviewer is already a member'),
      removeMember: () => refuse('too_few_members', 'A group keeps at least 2 members; delete the group instead'),
    });
    const app = makeApp(service);
    expect(await (await app.request('/api/groups/missing')).json()).toEqual({ error: 'not_found', message: 'Group not found' });
    expect((await app.request('/api/groups/missing', { ...json({ name: 'x' }), method: 'PATCH' })).status).toBe(404);
    const conflict = await app.request('/api/groups/g1/members', json({ agentId: 'reviewer' }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'conflict', message: 'reviewer is already a member' });
    const tooFew = await app.request('/api/groups/g1/members/reviewer', { method: 'DELETE' });
    expect(tooFew.status).toBe(400);
    expect(await tooFew.json()).toEqual({ error: 'bad_request', message: 'A group keeps at least 2 members; delete the group instead' });
  });
});
