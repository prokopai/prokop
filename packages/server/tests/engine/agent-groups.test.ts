/**
 * Group chat, phases 1 and 2: who answers, what a woken member receives,
 * cursors and the cap, mirroring a finished turn, handoffs and hops,
 * membership changes and deletion. The store is in memory; deliveries,
 * broadcasts and session rows are recorded.
 */

import { describe, expect, test } from 'bun:test';
import type { AgentGroupMessage, AssistantMessage, MessageWithParts, Preconfig, ServerMessage, Session, TextPart, ToolPart } from '@prokopai/sdk';
import { orderGroupThread, splitHostEvent } from '@prokopai/sdk';
import { createMemoryAgentGroupStore } from '@prokopai/core/application/ports/agent-groups';
import { createAgentGroupsService, type AgentGroupsService } from '@prokopai/core/application/groups/service';
import { resolveGroupTargets } from '@prokopai/core/domains/groups/routing';
import {
  capCatchUp, formatGroupWake, GROUP_CATCH_UP_MAX_CHARS, latestGroupWake, parseGroupWake,
} from '@prokopai/core/domains/groups/wake';
import { currentHop } from '@prokopai/agent/internal/messaging/wake';

const base: Preconfig = {
  id: 'implementer', name: 'Implementer', description: 'Writes and changes code.', systemPrompt: '', tools: null, model: null, provider: null,
  variant: null, settings: null, isDefault: false, mode: 'primary',
};
const IMPLEMENTER = base;
const REVIEWER: Preconfig = { ...base, id: 'reviewer', name: 'Reviewer', description: 'Reviews diffs for bugs.', modelHarness: 'codex-cli', model: 'gpt-5.5', variant: 'high' };
const ARCHITECT: Preconfig = { ...base, id: 'idea-architect', name: 'Idea Architect', description: '' };
const AGENTS = [IMPLEMENTER, REVIEWER, ARCHITECT];
const MEMBERS = AGENTS.map((agent) => ({ agentId: agent.id, name: agent.name }));

function user(sessionId: string, id: string, text: string): MessageWithParts {
  return { message: { id, sessionId, role: 'user', createdAt: 1 }, parts: [{ id: `${id}-t`, messageId: id, createdAt: 1, type: 'text', text } as TextPart] };
}
function assistant(sessionId: string, id: string, parts: Array<string | ToolPart>, status: AssistantMessage['status'] = 'completed', error?: string): MessageWithParts {
  const message = { id, sessionId, role: 'assistant', status, createdAt: 2, modelId: 'm', providerId: 'p', tokens: { prompt: 0, completion: 0 }, cost: 0, ...(error ? { error } : {}) } as AssistantMessage;
  return { message, parts: parts.map((part, index) => typeof part === 'string'
    ? ({ id: `${id}-${index}`, messageId: id, createdAt: 2, type: 'text', text: part } as TextPart)
    : part) };
}
const tool = (callId: string, name: string, input: Record<string, unknown>, summary?: string): ToolPart => ({
  id: `p-${callId}`, messageId: 'm', createdAt: 2, type: 'tool', callId, name,
  state: { status: 'completed', input, output: { big: 'x'.repeat(5_000) }, startedAt: 1, completedAt: 2 },
  ...(summary ? { presentation: { summary, debugAvailable: true } } : {}),
});

function harness(options: { maxHops?: number } = {}) {
  const sessions = new Map<string, Session>();
  const transcripts = new Map<string, MessageWithParts[]>();
  const deliveries: Array<{ sessionId: string; content: string; key: string }> = [];
  const broadcasts: ServerMessage[] = [];
  const pins: Array<{ sessionId: string; harness: string; model: string | null; variant: string | null }> = [];
  const interrupted: string[] = [];
  const store = createMemoryAgentGroupStore();
  let clock = 0;
  const service = createAgentGroupsService({
    store,
    sessions: {
      getSession: (id) => sessions.get(id) ?? null,
      createSession: (input) => {
        const record = { ...input, createdAt: '', updatedAt: '' } as Session;
        sessions.set(record.id, record);
        return record;
      },
      deleteSession: (id) => { sessions.delete(id); },
      setPermissionMode: (id, permissionMode) => {
        const current = sessions.get(id);
        if (current) sessions.set(id, { ...current, permissionMode });
      },
      getMessageWithParts: async (sessionId, messageId) => transcripts.get(sessionId)?.find((entry) => entry.message.id === messageId) ?? null,
      listTranscript: async (sessionId) => transcripts.get(sessionId) ?? [],
    },
    getPreconfigOrAgent: async (id) => AGENTS.find((agent) => agent.id === id) ?? null,
    toolSummaryTemplates: async () => new Map([['edit', 'edited {file_path}']]),
    deliver: async (input) => { deliveries.push(input); },
    pinModel: async (input) => { pins.push(input); },
    maxHops: () => options.maxHops ?? 6,
    interrupt: async (sessionId) => { interrupted.push(sessionId); },
    broadcast: (message) => { broadcasts.push(message); },
    now: () => `2026-10-23T00:00:${String(clock++).padStart(2, '0')}.000Z`,
  });
  const wakes = () => deliveries.map((delivery) => ({ ...delivery, wake: parseGroupWake(delivery.content)!, body: splitHostEvent(delivery.content).body }));
  return { service, store, sessions, transcripts, deliveries, broadcasts, pins, interrupted, wakes };
}

async function group(h: ReturnType<typeof harness>, members = ['implementer', 'reviewer']) {
  const created = await h.service.create({ workspaceId: 'ws-1', name: 'API work', memberAgentIds: members });
  if (!created.ok) throw new Error(created.error);
  return created.value;
}
const memberSession = (h: ReturnType<typeof harness>, agentId: string) =>
  [...h.sessions.values()].find((session) => (session.metadata?.groupMember as { agentId: string } | undefined)?.agentId === agentId)!;
const unwrap = <T,>(result: Awaited<ReturnType<AgentGroupsService['postUserMessage']>> | { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value as T;
};

describe('routing', () => {
  test('no mention wakes the default member, @Name the named ones, @everyone all, chips win and non-members are ignored', () => {
    expect(resolveGroupTargets('add rate limiting', [], MEMBERS, 'reviewer')).toEqual(['reviewer']);
    expect(resolveGroupTargets('@Implementer add rate limiting', [], MEMBERS, 'reviewer')).toEqual(['implementer']);
    expect(resolveGroupTargets('@implementer and @Reviewer: look', [], MEMBERS, 'reviewer')).toEqual(['implementer', 'reviewer']);
    expect(resolveGroupTargets('@Idea Architect, thoughts?', [], MEMBERS, 'reviewer')).toEqual(['idea-architect']);
    expect(resolveGroupTargets('@idea-architect?', [], MEMBERS, 'reviewer')).toEqual(['idea-architect']);
    expect(resolveGroupTargets('@everyone status please', [], MEMBERS, 'reviewer')).toEqual(['implementer', 'reviewer', 'idea-architect']);
    expect(resolveGroupTargets('mail me at a@reviewer.com', [], MEMBERS, 'implementer')).toEqual(['implementer']);
    expect(resolveGroupTargets('@Reviewers are busy', [], MEMBERS, 'implementer')).toEqual(['implementer']);
    expect(resolveGroupTargets('@Reviewer check it', ['implementer', 'ghost'], MEMBERS, 'reviewer')).toEqual(['implementer']);
    expect(resolveGroupTargets('thanks all', [], MEMBERS, 'ghost')).toEqual(['implementer']);
    expect(resolveGroupTargets('anyone', [], [], 'implementer')).toEqual([]);
  });
});

describe('wake format', () => {
  const names = new Map([['implementer', 'Implementer'], ['reviewer', 'Reviewer']]);
  const message = (seq: number, text: string, author: string | null = null): AgentGroupMessage => ({
    id: `m${seq}`, groupId: 'g', seq, authorKind: author ? 'agent' : 'user', authorAgentId: author, targetAgentId: null, sourceMessageId: null,
    parts: [{ id: `p${seq}`, messageId: `m${seq}`, createdAt: 1, type: 'text', text }], hop: 0, createdAt: '',
  });

  test('round-trips the group, hop and range; the roster and the instruction are in the body', () => {
    const catchUp = capCatchUp([message(4, '@Reviewer check it'), message(5, 'On it', 'reviewer')], names);
    const text = formatGroupWake({
      group: { id: 'g1', name: 'API work' }, member: { agentId: 'reviewer', name: 'Reviewer' },
      roster: [{ agentId: 'implementer', name: 'Implementer', description: 'Writes code.' }, { agentId: 'reviewer', name: 'Reviewer', description: '' }],
      catchUp, hop: 2, reason: 'mentioned',
    });
    expect(splitHostEvent(text).event).toMatchObject({ kind: 'group', id: 'g1', label: 'API work', meta: 'mentioned', summary: '[group "API work": 2 new messages, mentioned]' });
    expect(parseGroupWake(text)).toEqual({ groupId: 'g1', groupName: 'API work', hop: 2, fromSeq: 4, toSeq: 5 });
    expect(text).toContain('You are Reviewer (id: reviewer)');
    expect(text).toContain('- Implementer (implementer): Writes code.');
    expect(text).toContain('[User] @Reviewer check it');
    expect(text).toContain('[Reviewer] On it');
    expect(text).toContain('handoff_to_agent');
    expect(parseGroupWake('Just a prompt')).toBeNull();
    expect(currentHop([user('s', 'u1', text)])).toBe(2);
    expect(currentHop([user('s', 'u1', text), user('s', 'u2', 'typed by a person')])).toBe(0);
    expect(latestGroupWake([user('s', 'u1', text), assistant('s', 'a1', ['ok'])], 'a1')?.messageId).toBe('u1');
  });

  test('the cap keeps the newest 50 messages or 20,000 characters and cuts a single oversized message', () => {
    const many = Array.from({ length: 120 }, (_, index) => message(index + 1, `message ${index + 1}`));
    const capped = capCatchUp(many, names);
    expect(capped.lines).toHaveLength(50);
    expect(capped.omitted).toBe(70);
    expect(capped.fromSeq).toBe(71);
    expect(capped.toSeq).toBe(120);
    expect(capped.lines[0]).toBe('[User] message 71');

    const long = Array.from({ length: 10 }, (_, index) => message(index + 1, 'x'.repeat(3_000)));
    const byChars = capCatchUp(long, names);
    expect(byChars.lines).toHaveLength(6);
    expect(byChars.omitted).toBe(4);
    expect(byChars.lines.join('\n').length).toBeLessThanOrEqual(GROUP_CATCH_UP_MAX_CHARS + 6);

    const huge = capCatchUp([message(1, 'short'), message(2, 'y'.repeat(30_000))], names);
    expect(huge.lines).toHaveLength(1);
    expect(huge.omitted).toBe(1);
    expect(huge.lines[0]).toContain('cut here');
    expect(huge.lines[0]!.length).toBeLessThan(GROUP_CATCH_UP_MAX_CHARS + 200);
  });
});

describe('group service', () => {
  test('creating a group makes one hidden member session per member on its own harness', async () => {
    const h = harness();
    const created = await group(h);
    expect(created).toMatchObject({ name: 'API work', workspaceId: 'ws-1', defaultAgentId: 'implementer', permissionMode: 'standard' });
    expect(memberSession(h, 'reviewer').permissionMode).toBe('standard');
    expect(created.members.map((member) => member.name)).toEqual(['Implementer', 'Reviewer']);
    const reviewer = memberSession(h, 'reviewer');
    expect(reviewer).toMatchObject({ workspaceId: 'ws-1', parentId: null, preconfigId: 'reviewer', agentId: 'reviewer', harness: 'codex-cli',
      selectedModel: 'gpt-5.5', selectedVariant: 'high', title: 'API work: Reviewer', metadata: { groupMember: { groupId: created.id, agentId: 'reviewer' } } });
    expect(memberSession(h, 'implementer').harness).toBe('prokop');
    expect(h.broadcasts.map((message) => message.type)).toEqual(['session.created', 'session.created', 'group.updated']);

    expect(await h.service.create({ workspaceId: 'ws-1', name: 'Solo', memberAgentIds: ['implementer'] })).toMatchObject({ ok: false, code: 'too_few_members' });
    expect(await h.service.create({ workspaceId: 'ws-1', name: 'Ghosts', memberAgentIds: ['implementer', 'ghost'] })).toMatchObject({ ok: false, code: 'agent_not_found' });
    expect(await h.service.create({ workspaceId: 'ws-1', name: 'Wrong default', memberAgentIds: ['implementer', 'reviewer'], defaultAgentId: 'idea-architect' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.service.create({ workspaceId: 'ws-1', name: 'Crowd', memberAgentIds: Array.from({ length: 11 }, (_, index) => `a${index}`) })).toMatchObject({ ok: false, code: 'too_many_members' });
    expect(h.sessions.size).toBe(2);
  });

  test('a post wakes the members it names with everything after their cursor, pinned, at hop 0', async () => {
    const h = harness();
    const g = await group(h);
    const posted = unwrap(await h.service.postUserMessage(g.id, { text: '@Reviewer check the bucket' }));
    expect(posted.message).toMatchObject({ seq: 1, authorKind: 'user', hop: 0 });
    expect(posted.woken).toEqual(['reviewer']);
    const [wake] = h.wakes();
    expect(wake!.sessionId).toBe(memberSession(h, 'reviewer').id);
    expect(wake!.key).toBe(`group-wake:${g.id}:reviewer:1`);
    expect(wake!.wake).toMatchObject({ groupId: g.id, hop: 0, fromSeq: 1, toSeq: 1 });
    expect(wake!.body).toContain('You are Reviewer (id: reviewer)');
    expect(wake!.body).toContain('[User] @Reviewer check the bucket');
    expect(h.pins).toEqual([{ sessionId: memberSession(h, 'reviewer').id, harness: 'codex-cli', model: 'gpt-5.5', variant: 'high' }]);
    expect(h.store.listMembers(g.id).map((member) => [member.agentId, member.cursorSeq])).toEqual([['implementer', 0], ['reviewer', 1]]);

    // Nothing mentioned: the default member, with the roster once and both messages.
    const second = unwrap(await h.service.postUserMessage(g.id, { text: 'thanks all' }));
    expect(second.woken).toEqual(['implementer']);
    const implementerWake = h.wakes()[1]!;
    expect(implementerWake.sessionId).toBe(memberSession(h, 'implementer').id);
    expect(implementerWake.wake).toMatchObject({ fromSeq: 1, toSeq: 2 });
    expect(implementerWake.body).toContain('You are Implementer');
    expect(splitHostEvent(implementerWake.content).event?.meta).toBe('default member');

    // Chips win over text; everyone wakes everyone; a second wake never repeats and sends no roster.
    unwrap(await h.service.postUserMessage(g.id, { text: 'go', mentions: ['reviewer'] }));
    expect(h.wakes()[2]).toMatchObject({ sessionId: memberSession(h, 'reviewer').id, wake: { fromSeq: 2, toSeq: 3 } });
    expect(h.wakes()[2]!.body).not.toContain('You are Reviewer (id: reviewer). This is your identity');
    unwrap(await h.service.postUserMessage(g.id, { text: '@everyone status' }));
    expect(h.wakes().slice(3).map((wake) => wake.wake.fromSeq)).toEqual([3, 4]);
    expect(h.broadcasts.filter((message) => message.type === 'group.message.created')).toHaveLength(4);
  });

  test('a finished member turn is mirrored with text in full and tool calls as summary lines; the member never reads itself back', async () => {
    const h = harness();
    const g = await group(h);
    unwrap(await h.service.postUserMessage(g.id, { text: '@Implementer add rate limiting' }));
    const implementer = memberSession(h, 'implementer');
    const wakeText = h.deliveries[0]!.content;
    const reply = assistant(implementer.id, 'a1', [
      tool('c1', 'edit', { file_path: 'middleware.ts', old_string: 'a', new_string: 'b' }),
      tool('c2', 'shell', { command: 'bun test' }, 'bun test'),
      'Done, token bucket in middleware.ts.',
    ]);
    h.transcripts.set(implementer.id, [user(implementer.id, 'u1', wakeText), reply]);

    expect(await h.service.mirrorFinishedTurn(reply.message as AssistantMessage)).toBe('mirrored');
    expect(await h.service.mirrorFinishedTurn(reply.message as AssistantMessage)).toBe('skipped');
    const [, mirrored] = h.store.listMessages(g.id, { limit: 10 });
    expect(mirrored).toMatchObject({ seq: 2, authorKind: 'agent', authorAgentId: 'implementer', sourceMessageId: 'a1', hop: 0 });
    expect(mirrored!.parts.map((part) => part.type)).toEqual(['tool', 'tool', 'text']);
    const edit = mirrored!.parts[0] as ToolPart;
    expect(edit).toMatchObject({ name: 'edit', callId: 'c1', state: { status: 'completed', input: {}, output: null }, presentation: { summary: 'edited middleware.ts', debugAvailable: false } });
    expect(JSON.stringify(mirrored!.parts)).not.toContain('xxxx');
    expect((mirrored!.parts[1] as ToolPart).presentation?.summary).toBe('bun test');

    // The reviewer's catch-up carries the reply with its tool lines; the implementer's next catch-up does not carry its own reply.
    unwrap(await h.service.postUserMessage(g.id, { text: '@Reviewer check it' }));
    const reviewerWake = h.wakes()[1]!;
    expect(reviewerWake.body).toContain('[Implementer] (edit: edited middleware.ts)\n(shell: bun test)\nDone, token bucket in middleware.ts.');
    unwrap(await h.service.postUserMessage(g.id, { text: '@Implementer and now persist it' }));
    const implementerWake = h.wakes()[2]!;
    expect(implementerWake.body).not.toContain('[Implementer]');
    expect(implementerWake.body).toContain('[User] @Reviewer check it');
    expect(implementerWake.wake).toMatchObject({ fromSeq: 3, toSeq: 4 });

    // A failed turn posts its error; a compaction summary and a streaming message are not mirrored.
    const failed = assistant(implementer.id, 'a2', [], 'error', 'rate limited');
    h.transcripts.set(implementer.id, [...h.transcripts.get(implementer.id)!, failed]);
    expect(await h.service.mirrorFinishedTurn(failed.message as AssistantMessage)).toBe('mirrored');
    expect((h.store.listMessages(g.id, { limit: 1 })[0]!.parts[0] as TextPart).text).toBe('The turn failed: rate limited');
    expect(await h.service.mirrorFinishedTurn({ ...(reply.message as AssistantMessage), id: 'a3', summary: true })).toBe('skipped');
    expect(await h.service.mirrorFinishedTurn({ ...(reply.message as AssistantMessage), id: 'a4', status: 'streaming' })).toBe('skipped');
    // A session outside any group is ignored.
    expect(await h.service.mirrorFinishedTurn({ ...(reply.message as AssistantMessage), id: 'a5', sessionId: 'elsewhere' })).toBe('skipped');
  });

  test('a handoff posts a visible handoff and wakes the target one hop further; self, non-members and the limit are refused', async () => {
    const h = harness({ maxHops: 2 });
    const g = await group(h, ['implementer', 'reviewer', 'idea-architect']);
    unwrap(await h.service.postUserMessage(g.id, { text: '@Implementer add rate limiting, then hand it to Reviewer' }));
    const implementer = memberSession(h, 'implementer');
    h.transcripts.set(implementer.id, [user(implementer.id, 'u1', h.deliveries[0]!.content)]);

    expect(await h.service.handoff(implementer.id, { agent_id: 'implementer', message: 'x' })).toMatchObject({ ok: false, code: 'self_handoff' });
    expect(await h.service.handoff(implementer.id, { agent_id: 'ghost', message: 'x' })).toMatchObject({ ok: false, code: 'not_member' });
    expect(await h.service.handoff(implementer.id, { agent_id: 'reviewer', message: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.service.handoff('not-a-member-session', { agent_id: 'reviewer', message: 'x' })).toMatchObject({ ok: false, code: 'not_member' });
    expect(h.deliveries).toHaveLength(1);

    const handed = unwrap(await h.service.handoff(implementer.id, { agent_id: 'reviewer', message: 'Persisted in Redis, please review middleware.ts' }));
    expect(handed).toMatchObject({ target: 'reviewer', hop: 1, seq: 2 });
    expect(h.store.listMessages(g.id, { limit: 1 })[0]).toMatchObject({ authorKind: 'handoff', authorAgentId: 'implementer', targetAgentId: 'reviewer', hop: 1 });
    const reviewerWake = h.wakes()[1]!;
    expect(reviewerWake.sessionId).toBe(memberSession(h, 'reviewer').id);
    expect(reviewerWake.wake).toMatchObject({ hop: 1, fromSeq: 1, toSeq: 2 });
    expect(reviewerWake.body).toContain('[Implementer → Reviewer, handoff] Persisted in Redis');
    expect(splitHostEvent(reviewerWake.content).event?.meta).toBe('handoff from Implementer');

    // The reviewer hands on at hop 2; a third handoff would pass the limit of 2.
    const reviewer = memberSession(h, 'reviewer');
    h.transcripts.set(reviewer.id, [user(reviewer.id, 'u1', reviewerWake.content)]);
    expect(unwrap(await h.service.handoff(reviewer.id, { agent_id: 'idea-architect', message: 'Design question' }))).toMatchObject({ hop: 2 });
    const architect = memberSession(h, 'idea-architect');
    h.transcripts.set(architect.id, [user(architect.id, 'u1', h.deliveries[2]!.content)]);
    expect(await h.service.handoff(architect.id, { agent_id: 'implementer', message: 'Back to you' })).toMatchObject({ ok: false, code: 'hop_limit' });
    expect(h.deliveries).toHaveLength(3);
    // A member's reply during a handoff turn is stored at that hop.
    const reply = assistant(reviewer.id, 'a1', ['Looks right.']);
    h.transcripts.set(reviewer.id, [...h.transcripts.get(reviewer.id)!, reply]);
    await h.service.mirrorFinishedTurn(reply.message as AssistantMessage);
    expect(h.store.listMessages(g.id, { limit: 1 })[0]).toMatchObject({ authorKind: 'agent', authorAgentId: 'reviewer', hop: 1 });
  });

  test("a reply reads ahead of the handoff its turn posted, in the thread, group_history and later catch-ups, while the target is woken at once", async () => {
    const h = harness();
    const g = await group(h, ['implementer', 'reviewer', 'idea-architect']);
    unwrap(await h.service.postUserMessage(g.id, { text: '@Reviewer review it, then hand the fix to Implementer' }));
    const reviewer = memberSession(h, 'reviewer');
    // Mid-turn: the wake, then the reply still streaming when the handoff tool runs.
    const wake = user(reviewer.id, 'u1', h.deliveries[0]!.content);
    h.transcripts.set(reviewer.id, [wake, assistant(reviewer.id, 'a1', ['Reading middleware.ts'], 'streaming')]);
    expect(unwrap(await h.service.handoff(reviewer.id, { agent_id: 'implementer', message: 'Fix the TTL in middleware.ts' }))).toMatchObject({ seq: 2, hop: 1 });
    expect(h.store.listMessages(g.id, { limit: 1 })[0]).toMatchObject({ authorKind: 'handoff', sourceMessageId: 'a1' });
    // The target does not wait for the reply.
    expect(h.wakes()[1]).toMatchObject({ sessionId: memberSession(h, 'implementer').id, wake: { hop: 1, fromSeq: 1, toSeq: 2 } });
    expect(h.wakes()[1]!.body).toContain('[Reviewer → Implementer, handoff] Fix the TTL in middleware.ts');

    // The turn ends: its reply is mirrored (the handoff naming it is not a copy of it) and stored after the handoff.
    const reply = assistant(reviewer.id, 'a1', ['Reading middleware.ts', tool('c1', 'handoff_to_agent', { agent_id: 'implementer' }, 'Implementer'), 'One fix needed, Implementer has it.']);
    h.transcripts.set(reviewer.id, [wake, reply]);
    expect(await h.service.mirrorFinishedTurn(reply.message as AssistantMessage)).toBe('mirrored');
    expect(await h.service.mirrorFinishedTurn(reply.message as AssistantMessage)).toBe('skipped');
    const stored = h.store.listMessages(g.id, { limit: 10 });
    expect(stored.map((message) => [message.seq, message.authorKind])).toEqual([[1, 'user'], [2, 'handoff'], [3, 'agent']]);
    expect(stored[2]).toMatchObject({ sourceMessageId: 'a1', hop: 0 });
    const listed = unwrap(h.service.listMessages(g.id, {}));
    expect(orderGroupThread(listed.messages).map((message) => message.seq)).toEqual([1, 3, 2]);

    // group_history and a later catch-up read the reply, its handoff line, then what came after.
    const architect = memberSession(h, 'idea-architect');
    const history = unwrap(await h.service.history(architect.id, {}));
    expect(history.messages.map((message) => [message.seq, message.author])).toEqual([
      [1, '[User]'], [3, '[Reviewer]'], [2, '[Reviewer → Implementer, handoff]'],
    ]);
    expect(history.has_more).toBe(false);
    expect(unwrap(await h.service.history(architect.id, { after_seq: 1, limit: 1 })).messages.map((message) => message.seq)).toEqual([2]);
    unwrap(await h.service.postUserMessage(g.id, { text: '@Idea Architect thoughts?' }));
    const architectWake = h.wakes().at(-1)!;
    expect(architectWake.wake).toMatchObject({ fromSeq: 1, toSeq: 4 });
    const at = (text: string) => architectWake.body.indexOf(text);
    expect(at('[Reviewer] Reading middleware.ts\n(handoff_to_agent: Implementer)')).toBeGreaterThan(at('[User] @Reviewer review it'));
    expect(at('[Reviewer → Implementer, handoff]')).toBeGreaterThan(at('[Reviewer] Reading'));
    expect(at('[User] @Idea Architect thoughts?')).toBeGreaterThan(at('[Reviewer → Implementer, handoff]'));
    expect(h.store.listMembers(g.id).find((member) => member.agentId === 'idea-architect')!.cursorSeq).toBe(4);

    // A handoff made outside a running turn (no streaming reply) keeps post order.
    const implementer = memberSession(h, 'implementer');
    h.transcripts.set(implementer.id, [user(implementer.id, 'u1', h.deliveries[1]!.content)]);
    unwrap(await h.service.handoff(implementer.id, { agent_id: 'reviewer', message: 'Fixed' }));
    expect(h.store.listMessages(g.id, { limit: 1 })[0]).toMatchObject({ authorKind: 'handoff', sourceMessageId: null, hop: 2 });
  });

  test('a long-idle member gets the newest 50 with the omitted count and can read the rest with group_history, which never moves the cursor', async () => {
    const h = harness();
    const g = await group(h);
    for (let index = 1; index <= 60; index += 1) {
      unwrap(await h.service.postUserMessage(g.id, { text: `note ${index}`, mentions: ['implementer'] }));
    }
    unwrap(await h.service.postUserMessage(g.id, { text: '@Reviewer catch up' }));
    const reviewerWake = h.wakes().find((wake) => wake.sessionId === memberSession(h, 'reviewer').id)!;
    expect(reviewerWake.wake).toMatchObject({ fromSeq: 12, toSeq: 61 });
    expect(reviewerWake.body).toContain('11 earlier group messages omitted, use group_history');
    expect(reviewerWake.body).not.toContain('[User] note 11\n');
    expect(h.store.listMembers(g.id).find((member) => member.agentId === 'reviewer')!.cursorSeq).toBe(61);

    const reviewer = memberSession(h, 'reviewer');
    const older = unwrap(await h.service.history(reviewer.id, { before_seq: 12, limit: 5 }));
    expect(older.messages.map((message) => message.seq)).toEqual([7, 8, 9, 10, 11]);
    expect(older.messages[0]).toMatchObject({ author: '[User]', kind: 'user', text: 'note 7' });
    expect(older.has_more).toBe(true);
    const start = unwrap(await h.service.history(reviewer.id, { before_seq: 3 }));
    expect(start.messages.map((message) => message.seq)).toEqual([1, 2]);
    expect(start.has_more).toBe(false);
    const after = unwrap(await h.service.history(reviewer.id, { after_seq: 58 }));
    expect(after.messages.map((message) => message.seq)).toEqual([59, 60, 61]);
    expect(after.has_more).toBe(false);
    const newest = unwrap(await h.service.history(reviewer.id, { limit: 2 }));
    expect(newest.messages.map((message) => message.seq)).toEqual([60, 61]);
    expect(await h.service.history(reviewer.id, { before_seq: 2, after_seq: 1 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.service.history(reviewer.id, { limit: 'many' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.service.history('stranger', {})).toMatchObject({ ok: false, code: 'not_member' });
    expect(h.store.listMembers(g.id).find((member) => member.agentId === 'reviewer')!.cursorSeq).toBe(61);

    // The next wake sends only what came after; the omitted ones are never resent.
    unwrap(await h.service.postUserMessage(g.id, { text: '@Reviewer one more' }));
    expect(h.wakes().at(-1)!.wake).toMatchObject({ fromSeq: 62, toSeq: 62 });
  });

  test('membership changes post system lines, re-send the roster, and keep the group between 2 and 10; deleting the group deletes every member session', async () => {
    const h = harness();
    const g = await group(h);
    unwrap(await h.service.postUserMessage(g.id, { text: '@Reviewer hi' }));
    expect(await h.service.removeMember(g.id, 'reviewer')).toMatchObject({ ok: false, code: 'too_few_members' });
    expect(await h.service.addMember(g.id, 'reviewer')).toMatchObject({ ok: false, code: 'already_member' });
    expect(await h.service.addMember(g.id, 'ghost')).toMatchObject({ ok: false, code: 'agent_not_found' });

    const added = unwrap(await h.service.addMember(g.id, 'idea-architect'));
    expect(added.members.map((member) => member.agentId)).toEqual(['implementer', 'reviewer', 'idea-architect']);
    expect(h.store.listMessages(g.id, { limit: 1 })[0]).toMatchObject({ authorKind: 'system' });
    // The new member starts at the current position: its first catch-up is the join line onwards.
    unwrap(await h.service.postUserMessage(g.id, { text: '@Idea Architect welcome' }));
    const architectWake = h.wakes().at(-1)!;
    expect(architectWake.body).toContain('[system] Idea Architect joined the group.');
    expect(architectWake.body).not.toContain('[User] @Reviewer hi');
    expect(architectWake.body).toContain('- Reviewer (reviewer)');
    // The reviewer knew the old roster; the change makes its next wake carry the new one.
    unwrap(await h.service.postUserMessage(g.id, { text: '@Reviewer again' }));
    expect(h.wakes().at(-1)!.body).toContain('- Idea Architect (idea-architect)');

    const updated = unwrap(await h.service.update(g.id, { name: 'API work v2', defaultAgentId: 'reviewer' }));
    expect(updated).toMatchObject({ name: 'API work v2', defaultAgentId: 'reviewer' });
    expect(await h.service.update(g.id, { defaultAgentId: 'ghost' })).toMatchObject({ ok: false, code: 'not_member' });

    const reviewerSessionId = memberSession(h, 'reviewer').id;
    const removed = unwrap(await h.service.removeMember(g.id, 'reviewer'));
    expect(removed.members.map((member) => member.agentId)).toEqual(['implementer', 'idea-architect']);
    expect(removed.defaultAgentId).toBe('implementer');
    expect(h.interrupted).toEqual([reviewerSessionId]);
    expect(h.sessions.has(reviewerSessionId)).toBe(false);
    expect(h.broadcasts.filter((message) => message.type === 'session.deleted')).toEqual([{ type: 'session.deleted', sessionId: reviewerSessionId }]);
    expect(await h.service.memberOf(reviewerSessionId)).toBeNull();

    const remaining = h.store.listMembers(g.id).map((member) => member.memberSessionId);
    expect(await h.service.remove(g.id)).toMatchObject({ ok: true, value: { id: g.id, workspaceId: 'ws-1' } });
    expect(h.sessions.size).toBe(0);
    expect(h.interrupted).toEqual([reviewerSessionId, ...remaining]);
    expect(h.store.getGroup(g.id)).toBeNull();
    expect(h.broadcasts.at(-1)).toEqual({ type: 'group.deleted', groupId: g.id, workspaceId: 'ws-1' });
    expect(await h.service.remove(g.id)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await h.service.postUserMessage(g.id, { text: 'hello?' })).toMatchObject({ ok: false, code: 'not_found' });
  });

  test('the permission mode is one setting for the group: every member session gets it, including ones added or recreated later', async () => {
    const h = harness();
    const created = unwrap<{ id: string; permissionMode: string }>(await h.service.create({ workspaceId: 'ws-1', name: 'Hands off', memberAgentIds: ['implementer', 'reviewer'], permissionMode: 'full' }));
    expect(created.permissionMode).toBe('full');
    expect([...h.sessions.values()].map((session) => session.permissionMode)).toEqual(['full', 'full']);

    const updated = unwrap<{ permissionMode: string }>(await h.service.update(created.id, { permissionMode: 'extended' }));
    expect(updated.permissionMode).toBe('extended');
    expect([...h.sessions.values()].map((session) => session.permissionMode)).toEqual(['extended', 'extended']);
    expect(h.broadcasts.at(-1)).toMatchObject({ type: 'group.updated', group: { permissionMode: 'extended' } });

    unwrap(await h.service.addMember(created.id, 'idea-architect'));
    expect(memberSession(h, 'idea-architect').permissionMode).toBe('extended');
    // A member session deleted behind the group's back comes back with the group's mode.
    h.sessions.delete(memberSession(h, 'reviewer').id);
    unwrap(await h.service.postUserMessage(created.id, { text: '@Reviewer still there?' }));
    expect(memberSession(h, 'reviewer').permissionMode).toBe('extended');

    expect(await h.service.update(created.id, { permissionMode: 'yolo' as never })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.service.create({ workspaceId: 'ws-1', name: 'Bad', memberAgentIds: ['implementer', 'reviewer'], permissionMode: 'yolo' as never })).toMatchObject({ ok: false, code: 'invalid' });
  });

  test('the same agent in two groups has two member sessions and messages never cross', async () => {
    const h = harness();
    const first = await group(h);
    const second = unwrap(await h.service.create({ workspaceId: 'ws-1', name: 'Docs', memberAgentIds: ['implementer', 'idea-architect'] }));
    const implementerSessions = [...h.sessions.values()].filter((session) => session.agentId === 'implementer');
    expect(implementerSessions).toHaveLength(2);
    unwrap(await h.service.postUserMessage(first.id, { text: '@Implementer API thing' }));
    unwrap(await h.service.postUserMessage(second.id, { text: '@Implementer docs thing' }));
    const [apiWake, docsWake] = h.wakes();
    expect(apiWake!.sessionId).not.toBe(docsWake!.sessionId);
    expect(apiWake!.body).toContain('API thing');
    expect(apiWake!.body).not.toContain('docs thing');
    expect(docsWake!.body).toContain('docs thing');
    expect((await h.service.memberOf(docsWake!.sessionId))?.group.id).toBe(second.id);
    expect(await h.service.list('ws-1')).toHaveLength(2);
  });
});
