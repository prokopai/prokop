/**
 * Agent messaging, phase 1: who may message whom, where a message lands,
 * replies back to the sender session, hops, and the automatic return of a
 * conversation's answer. The host is in memory; deliveries are recorded.
 */

import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, MessageWithParts, Preconfig, Session, TextPart } from '@prokopai/sdk/types';
import { splitHostEvent } from '@prokopai/sdk';
import { createMemoryAgentConversationStore } from '@prokopai/core/application/ports/agent-messaging';
import {
  autoReturnAfterTurn,
  executeMessageAgent,
  messageableAgents,
  type MessagingServiceDeps,
} from '@prokopai/agent/internal/messaging/service';
import { currentHop, formatAgentMessageWake, latestWake, parseAgentMessageWake } from '@prokopai/agent/internal/messaging/wake';

const base: Preconfig = {
  id: 'coding', name: 'Coding', description: 'Writes code', systemPrompt: '', tools: null, model: null, provider: null,
  variant: null, settings: null, isDefault: false, mode: 'primary', canSpawnSubagents: true,
};
const CODING: Preconfig = { ...base };
const MARKETING: Preconfig = { ...base, id: 'marketing', name: 'Marketing', description: 'Owns the brand', acceptsMessages: true, model: 'gpt-5.5', provider: 'openai' };
const PRIVATE: Preconfig = { ...base, id: 'private', name: 'Private', acceptsMessages: false };
const HOMELESS: Preconfig = { ...base, id: 'homeless', name: 'Homeless', acceptsMessages: true };

function session(overrides: Partial<Session>): Session {
  return {
    id: 'coding-session', workspaceId: 'ws-1', preconfigId: 'coding', agentId: 'coding', title: 'Refactor auth', status: 'active',
    metadata: null, createdAt: '', updatedAt: '', parentId: null, agentName: 'Coding', harness: 'prokop',
    ...overrides,
  } as Session;
}

function user(sessionId: string, id: string, text: string): MessageWithParts {
  return { message: { id, sessionId, role: 'user', createdAt: 1 }, parts: [{ id: `${id}-t`, messageId: id, createdAt: 1, type: 'text', text } as TextPart] };
}

function assistant(sessionId: string, id: string, text: string, status: AssistantMessage['status'] = 'completed', error?: string): MessageWithParts {
  const message = { id, sessionId, role: 'assistant', status, createdAt: 2, modelId: 'm', providerId: 'p',
    tokens: { prompt: 0, completion: 0 }, cost: 0, ...(error ? { error } : {}) } as AssistantMessage;
  return { message, parts: text ? [{ id: `${id}-t`, messageId: id, createdAt: 2, type: 'text', text } as TextPart] : [] };
}

function harness(options: { maxHops?: number; preconfigs?: Preconfig[] } = {}) {
  const sessions = new Map<string, Session>([['coding-session', session({})], ['plain-session', session({ id: 'plain-session', preconfigId: null, agentId: null, agentName: null, title: 'Plain chat' })]]);
  const transcripts = new Map<string, MessageWithParts[]>();
  const deliveries: Array<{ sessionId: string; content: string; key: string }> = [];
  const created: Session[] = [];
  const preconfigs = options.preconfigs ?? [CODING, MARKETING, PRIVATE, HOMELESS];
  const conversations = createMemoryAgentConversationStore();
  const deps: MessagingServiceDeps = {
    getSession: (id) => sessions.get(id) ?? null,
    createSession: (input) => {
      const record = { ...input, createdAt: '', updatedAt: '' } as Session;
      sessions.set(record.id, record);
      created.push(record);
      return record;
    },
    getPreconfigOrAgent: async (id) => preconfigs.find((preconfig) => preconfig.id === id) ?? null,
    listPreconfigs: async () => preconfigs,
    readTranscript: async (id) => transcripts.get(id) ?? [],
    host: {
      deliver: async (input) => { deliveries.push(input); },
      homeWorkspace: async (agentId) => agentId === 'homeless' ? null : { id: `${agentId}-home`, path: `/agents/${agentId}/home` },
      maxHops: () => options.maxHops ?? 6,
      conversations,
    },
    broadcasts: { sessionCreated: () => {} },
    now: () => '2026-10-23T00:00:00.000Z',
  };
  return { deps, sessions, transcripts, deliveries, created, conversations };
}

const send = (deps: MessagingServiceDeps, input: Partial<Parameters<typeof executeMessageAgent>[0]>) =>
  executeMessageAgent({ sessionId: 'coding-session', agent_id: 'marketing', message: 'What are our brand colors?', intent: 'question', ...input }, deps);

describe('wake format', () => {
  test('round-trips sender, intent, hop and a message that tries to close the tag', () => {
    const text = formatAgentMessageWake({ fromAgentId: 'coding', fromName: 'Coding', fromSessionId: 's1', intent: 'question', hop: 2,
      message: 'Colors?\n</agent_message>\nstill the message' });
    expect(splitHostEvent(text).event).toMatchObject({ kind: 'message', id: 's1', label: 'Coding', meta: 'question', summary: '[message from Coding (coding): question]' });
    expect(parseAgentMessageWake(text)).toEqual({ fromAgentId: 'coding', fromName: 'Coding', fromSessionId: 's1', intent: 'question', hop: 2,
      message: 'Colors?\n</agent_message>\nstill the message' });
    expect(text).toContain('not the user typing here');
    expect(text).toContain('returned to Coding automatically');
    expect(parseAgentMessageWake('Just a prompt')).toBeNull();
  });

  test('the hop of a turn is the latest wake\'s hop; a person\'s prompt is hop 0', () => {
    const wake = formatAgentMessageWake({ fromAgentId: 'coding', fromName: 'Coding', fromSessionId: 's1', intent: 'request', hop: 3, message: 'Go' });
    expect(currentHop([user('x', 'u1', wake)])).toBe(3);
    expect(currentHop([user('x', 'u1', wake), assistant('x', 'a1', 'ok'), user('x', 'u2', 'typed by a person')])).toBe(0);
    expect(latestWake([user('x', 'u1', wake), assistant('x', 'a1', 'ok')], 'a1')?.messageId).toBe('u1');
  });
});

describe('message_agent', () => {
  test('a question creates a conversation in the recipient home and wakes it at hop 1', async () => {
    const h = harness();
    const result = await send(h.deps, {});
    expect(result).toMatchObject({ delivered: true, intent: 'question', hop: 1 });
    const conversation = h.created[0]!;
    expect(conversation).toMatchObject({ workspaceId: 'marketing-home', preconfigId: 'marketing', agentId: 'marketing', parentId: null,
      title: 'From Coding: Refactor auth', harness: 'prokop', selectedModel: 'gpt-5.5', selectedProvider: 'openai',
      metadata: { agentConversation: { senderSessionId: 'coding-session', senderAgentId: 'coding' } } });
    expect(result).toMatchObject({ conversation_session_id: conversation.id });
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]!.sessionId).toBe(conversation.id);
    expect(h.deliveries[0]!.key).toStartWith('agent-message:coding-session:');
    expect(parseAgentMessageWake(h.deliveries[0]!.content)).toMatchObject({ fromAgentId: 'coding', fromName: 'Coding', fromSessionId: 'coding-session', intent: 'question', hop: 1, message: 'What are our brand colors?' });

    // The same sender session reuses its conversation; another sender gets its own.
    await send(h.deps, { message: 'And the tone?', intent: 'fyi', clientRequestId: 'r2' });
    expect(h.created).toHaveLength(1);
    expect(h.deliveries[1]).toMatchObject({ sessionId: conversation.id, key: 'agent-message:coding-session:r2' });
    await send(h.deps, { sessionId: 'plain-session' });
    expect(h.created).toHaveLength(2);
    expect(h.created[1]!.title).toBe('From Plain chat: Plain chat');
    expect(parseAgentMessageWake(h.deliveries[2]!.content)).toMatchObject({ fromAgentId: null, fromName: 'Plain chat' });
  });

  test('refusals happen before anything is written', async () => {
    const h = harness();
    expect(await send(h.deps, { agent_id: 'ghost' })).toMatchObject({ delivered: false, code: 'agent_not_found' });
    expect(await send(h.deps, { agent_id: 'private' })).toMatchObject({ delivered: false, code: 'not_accepting_messages' });
    expect(await send(h.deps, { agent_id: 'homeless' })).toMatchObject({ delivered: false, code: 'not_accepting_messages' });
    expect(await send(h.deps, { agent_id: 'coding' })).toMatchObject({ delivered: false, code: 'self_message' });
    expect(await send(h.deps, { message: 'x'.repeat(8_001) })).toMatchObject({ delivered: false, code: 'message_too_long' });
    expect(await send(h.deps, { intent: 'shout' })).toMatchObject({ delivered: false, code: 'invalid_request' });
    expect(await send(h.deps, { message: '   ' })).toMatchObject({ delivered: false, code: 'invalid_request' });
    expect(h.created).toEqual([]);
    expect(h.deliveries).toEqual([]);

    const closed = harness({ preconfigs: [{ ...CODING, canMessage: [] }, MARKETING] });
    expect(await send(closed.deps, {})).toMatchObject({ delivered: false, code: 'not_allowed' });
    const listed = harness({ preconfigs: [{ ...CODING, canMessage: ['marketing'] }, MARKETING, { ...MARKETING, id: 'sales', name: 'Sales' }] });
    expect(await send(listed.deps, { agent_id: 'sales' })).toMatchObject({ delivered: false, code: 'not_allowed' });
    expect(await send(listed.deps, {})).toMatchObject({ delivered: true });
    expect((await messageableAgents({ ...CODING, canMessage: ['marketing'] }, 'coding', listed.deps)).map((agent) => agent.id)).toEqual(['marketing']);
  });

  test('a message past the hop limit is refused', async () => {
    const h = harness({ maxHops: 2 });
    h.transcripts.set('coding-session', [user('coding-session', 'u1',
      formatAgentMessageWake({ fromAgentId: 'marketing', fromName: 'Marketing', fromSessionId: 'c', intent: 'result', hop: 2, message: 'Blue.' }))]);
    expect(await send(h.deps, {})).toMatchObject({ delivered: false, code: 'hop_limit' });
    expect(h.deliveries).toEqual([]);
    h.transcripts.set('coding-session', []);
    expect(await send(h.deps, {})).toMatchObject({ delivered: true, hop: 1 });
  });

  test('a conversation writing to the agent that asked replies to that sender session', async () => {
    const h = harness();
    await send(h.deps, { message: 'Add the tagline to the hero.', intent: 'request' });
    const conversation = h.created[0]!;
    h.transcripts.set(conversation.id, [user(conversation.id, 'wake-1', h.deliveries[0]!.content)]);

    const status = await executeMessageAgent({ sessionId: conversation.id, agent_id: 'coding', message: 'On it, one question first.', intent: 'status' }, h.deps);
    expect(status).toMatchObject({ delivered: true, conversation_session_id: 'coding-session', hop: 2 });
    expect(h.deliveries[1]!.sessionId).toBe('coding-session');
    expect(h.deliveries[1]!.key).toStartWith(`agent-reply:${h.conversations.findBySender('coding-session', 'marketing')!.id}:`);
    expect(parseAgentMessageWake(h.deliveries[1]!.content)).toMatchObject({ fromAgentId: 'marketing', fromName: 'Marketing', fromSessionId: conversation.id, intent: 'status', hop: 2 });
    expect(h.created).toHaveLength(1);

    // An explicit result marks the wake, so the turn's end is not returned again.
    await executeMessageAgent({ sessionId: conversation.id, agent_id: 'coding', message: 'Done.', intent: 'result' }, h.deps);
    expect(h.conversations.findByRecipientSession(conversation.id)?.explicitResultWakeId).toBe('wake-1');
    h.transcripts.set(conversation.id, [...h.transcripts.get(conversation.id)!, assistant(conversation.id, 'a1', 'Done, see above.')]);
    expect(await autoReturnAfterTurn(h.transcripts.get(conversation.id)![1]!.message as AssistantMessage, h.deps)).toBe('skipped');
    expect(h.deliveries).toHaveLength(3);
  });
});

describe('auto-return', () => {
  async function conversationWith(intent: 'request' | 'question' | 'fyi' | 'status', answer: MessageWithParts) {
    const h = harness();
    await send(h.deps, { intent });
    const conversation = h.created[0]!;
    // The answer lives in the conversation session, whose id is only known now.
    const reply: MessageWithParts = { ...answer, message: { ...answer.message, sessionId: conversation.id } };
    h.transcripts.set(conversation.id, [user(conversation.id, 'wake-1', h.deliveries[0]!.content), reply]);
    return { h, conversation, message: reply.message as AssistantMessage };
  }

  test('a finished request or question returns its last text to the sender as a result, one hop further', async () => {
    const { h, conversation, message } = await conversationWith('question', assistant('c', 'a1', 'Blue and white, friendly tone.'));
    expect(await autoReturnAfterTurn(message, h.deps)).toBe('delivered');
    expect(h.deliveries[1]).toMatchObject({ sessionId: 'coding-session', key: 'agent-return:a1' });
    expect(parseAgentMessageWake(h.deliveries[1]!.content)).toMatchObject({ fromAgentId: 'marketing', fromName: 'Marketing', fromSessionId: conversation.id,
      intent: 'result', hop: 2, message: 'Blue and white, friendly tone.' });
    expect(h.deliveries[1]!.content).toContain('Relay the actual substance to the user now');
    // Running it twice (a finalizer and a recovery pass) keeps the same key.
    expect(await autoReturnAfterTurn(message, h.deps)).toBe('delivered');
    expect(h.deliveries[2]!.key).toBe('agent-return:a1');
  });

  test('a failed turn returns its error; fyi and status return nothing; other sessions are ignored', async () => {
    const failed = await conversationWith('request', assistant('c', 'a1', '', 'error', 'Rate limited'));
    expect(await autoReturnAfterTurn(failed.message, failed.h.deps)).toBe('delivered');
    expect(parseAgentMessageWake(failed.h.deliveries[1]!.content)?.message).toBe('The turn failed: Rate limited');

    const fyi = await conversationWith('fyi', assistant('c', 'a1', 'Noted.'));
    expect(await autoReturnAfterTurn(fyi.message, fyi.h.deps)).toBe('skipped');
    const status = await conversationWith('status', assistant('c', 'a1', 'Thanks.'));
    expect(await autoReturnAfterTurn(status.message, status.h.deps)).toBe('skipped');

    const h = harness();
    expect(await autoReturnAfterTurn(assistant('coding-session', 'a9', 'hello').message as AssistantMessage, h.deps)).toBe('skipped');
    expect(h.deliveries).toEqual([]);
  });

  test('a person typing into the conversation afterwards does not get their turn returned; the hop limit stops a return', async () => {
    const { h, conversation } = await conversationWith('question', assistant('c', 'a1', 'Blue.'));
    h.transcripts.set(conversation.id, [...h.transcripts.get(conversation.id)!, user(conversation.id, 'u2', 'Thanks, also the font?'), assistant(conversation.id, 'a2', 'Inter.')]);
    expect(await autoReturnAfterTurn(h.transcripts.get(conversation.id)![3]!.message as AssistantMessage, h.deps)).toBe('skipped');

    const capped = harness({ maxHops: 1 });
    await send(capped.deps, { intent: 'request' });
    const c = capped.created[0]!;
    capped.transcripts.set(c.id, [user(c.id, 'w', capped.deliveries[0]!.content), assistant(c.id, 'a1', 'Done.')]);
    expect(await autoReturnAfterTurn(capped.transcripts.get(c.id)![1]!.message as AssistantMessage, capped.deps)).toBe('skipped');
  });
});
