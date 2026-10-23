/**
 * The messaging service behind `message_agent`: who may message whom, where
 * a message lands, and the automatic return of an answer. One conversation
 * per sender session and recipient agent, a top-level session in the
 * recipient's home; a message from a conversation back to the agent that
 * started it is a reply to that exact sender session. Every delivery goes
 * through the host's delivery primitive, so the caller's harness and the
 * recipient's harness change nothing here.
 */

import { randomUUID } from 'node:crypto';
import type { AssistantMessage, MessageWithParts, Preconfig, Session } from '@prokopai/sdk/types';
import type { AgentMessagingHostPort } from '@prokopai/core/application/ports/agent-messaging';
import {
  currentHop,
  formatAgentMessageWake,
  isAgentMessageIntent,
  latestWake,
  type AgentMessageIntent,
} from '#agent/messaging/wake';

export const AGENT_MESSAGE_MAX_LENGTH = 8_000;
const TITLE_LENGTH = 120;

export interface MessagingServiceDeps {
  getSession(id: string): Promise<Session | null> | Session | null;
  createSession(input: Omit<Session, 'createdAt' | 'updatedAt'>): Promise<Session> | Session;
  getPreconfigOrAgent(id: string): Promise<Preconfig | null>;
  listPreconfigs(): Promise<Preconfig[]>;
  readTranscript(sessionId: string): Promise<MessageWithParts[]>;
  host: AgentMessagingHostPort;
  broadcasts: { sessionCreated(session: Session): void };
  now?: () => string;
}

export interface MessageAgentInput {
  sessionId: string;
  agent_id: string;
  message: string;
  intent?: string;
  /** A stable id per logical message: a retried call delivers once. */
  clientRequestId?: string;
}

export type MessageAgentFailure =
  | 'agent_not_found' | 'not_accepting_messages' | 'not_allowed'
  | 'hop_limit' | 'message_too_long' | 'self_message' | 'invalid_request';

export type MessageAgentOutput =
  | { delivered: true; conversation_session_id: string; intent: AgentMessageIntent; hop: number; note: string }
  | { delivered: false; code: MessageAgentFailure; error: string };

const ASYNC_NOTE = 'Delivery is async and does not end your turn: continue independent work; do not poll or send ack-only messages.';

function refuse(code: MessageAgentFailure, error: string): MessageAgentOutput {
  return { delivered: false, code, error };
}

/** The agent a session acts as, for naming and for the sender-side allow list. */
export function sessionAgentId(session: Session): string | null {
  return session.agentId ?? session.preconfigId ?? null;
}

/** `canMessage` as a predicate, mirroring `canSpawnSubagents`. */
export function mayMessage(sender: Preconfig | null, recipientId: string): boolean {
  const rule = sender?.canMessage;
  if (rule === undefined || rule === true) return true;
  if (rule === false || rule === null) return false;
  return rule.includes(recipientId);
}

/** Agents that accept messages and have a home, other than the caller's own agent. */
export async function messageableAgents(
  sender: Preconfig | null, senderAgentId: string | null, deps: Pick<MessagingServiceDeps, 'listPreconfigs' | 'host'>,
): Promise<Preconfig[]> {
  const result: Preconfig[] = [];
  for (const candidate of await deps.listPreconfigs()) {
    if (candidate.id === senderAgentId || candidate.acceptsMessages !== true || !mayMessage(sender, candidate.id)) continue;
    if (!await deps.host.homeWorkspace(candidate.id)) continue;
    result.push(candidate);
  }
  return result;
}

function conversationTitle(senderName: string, senderSession: Session): string {
  const title = senderSession.title ? `From ${senderName}: ${senderSession.title}` : `From ${senderName}`;
  return title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH - 1)}…` : title;
}

export async function executeMessageAgent(input: MessageAgentInput, deps: MessagingServiceDeps): Promise<MessageAgentOutput> {
  const now = deps.now ?? (() => new Date().toISOString());
  const intent = input.intent === undefined ? 'request' : input.intent;
  if (!isAgentMessageIntent(intent)) return refuse('invalid_request', 'intent must be request, question, status, result or fyi');
  const agentId = typeof input.agent_id === 'string' ? input.agent_id.trim() : '';
  if (!agentId) return refuse('invalid_request', 'agent_id is required');
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) return refuse('invalid_request', 'message is required');
  if (message.length > AGENT_MESSAGE_MAX_LENGTH) {
    return refuse('message_too_long', `message is ${message.length} characters; the limit is ${AGENT_MESSAGE_MAX_LENGTH}`);
  }

  const senderSession = await deps.getSession(input.sessionId);
  if (!senderSession) return refuse('invalid_request', 'The calling session is unknown');
  const senderAgentId = sessionAgentId(senderSession);
  const senderPreconfig = senderAgentId ? await deps.getPreconfigOrAgent(senderAgentId) : null;
  const senderName = senderPreconfig?.name ?? senderSession.title ?? 'A session';
  if (!mayMessage(senderPreconfig, agentId)) return refuse('not_allowed', `Your agent may not message ${agentId}`);

  const transcript = await deps.readTranscript(input.sessionId);
  const hop = currentHop(transcript) + 1;
  const maxHops = deps.host.maxHops();
  if (hop > maxHops) {
    return refuse('hop_limit', `This message would be hop ${hop}; messages stop at ${maxHops} hops from the user's turn. Report to the user instead.`);
  }

  // A conversation writing back to the agent that started it: a reply to that sender session.
  const own = deps.host.conversations.findByRecipientSession(input.sessionId);
  if (own && own.senderAgentId === agentId) {
    const recipient = await deps.getPreconfigOrAgent(agentId);
    const wake = formatAgentMessageWake({
      fromAgentId: own.recipientAgentId, fromName: senderName, fromSessionId: input.sessionId, intent, hop, message,
    });
    await deps.host.deliver({
      sessionId: own.senderSessionId,
      content: wake,
      key: `agent-reply:${own.id}:${input.clientRequestId ?? randomUUID()}`,
    });
    if (intent === 'result') {
      const current = latestWake(transcript);
      if (current) deps.host.conversations.upsert({ ...own, explicitResultWakeId: current.messageId });
    }
    return {
      delivered: true, conversation_session_id: own.senderSessionId, intent, hop,
      note: `Sent to ${recipient?.name ?? agentId} in the session that wrote to you. ${ASYNC_NOTE}`,
    };
  }

  if (agentId === senderAgentId) return refuse('self_message', 'An agent cannot message itself');
  const recipient = await deps.getPreconfigOrAgent(agentId);
  if (!recipient) return refuse('agent_not_found', `No agent "${agentId}"`);
  if (recipient.acceptsMessages !== true) return refuse('not_accepting_messages', `${recipient.name} does not accept messages from other agents`);
  const home = await deps.host.homeWorkspace(agentId);
  if (!home) return refuse('not_accepting_messages', `${recipient.name} has no home to answer from`);

  let conversation = deps.host.conversations.findBySender(input.sessionId, agentId);
  if (conversation && !await deps.getSession(conversation.recipientSessionId)) {
    deps.host.conversations.delete(conversation.id);
    conversation = null;
  }
  if (!conversation) {
    const created = await deps.createSession({
      id: randomUUID(),
      workspaceId: home.id,
      workspaceRootId: null,
      preconfigId: recipient.id,
      agentId: recipient.id,
      agentName: recipient.name,
      title: conversationTitle(senderName, senderSession),
      status: 'active',
      // The link the learning policy and the delete cascade read.
      metadata: { agentConversation: { senderSessionId: input.sessionId, senderAgentId } },
      parentId: null,
      harness: recipient.modelHarness ?? 'prokop',
      selectedModel: recipient.model,
      selectedProvider: recipient.provider,
      selectedVariant: recipient.variant ?? null,
    });
    deps.broadcasts.sessionCreated(created);
    conversation = {
      id: randomUUID(),
      senderSessionId: input.sessionId,
      senderAgentId,
      recipientAgentId: recipient.id,
      recipientSessionId: created.id,
      explicitResultWakeId: null,
      createdAt: now(),
    };
    deps.host.conversations.upsert(conversation);
  }

  const wake = formatAgentMessageWake({
    fromAgentId: senderAgentId, fromName: senderName, fromSessionId: input.sessionId, intent, hop, message,
  });
  await deps.host.deliver({
    sessionId: conversation.recipientSessionId,
    content: wake,
    key: `agent-message:${input.sessionId}:${input.clientRequestId ?? randomUUID()}`,
  });
  const returns = intent === 'request' || intent === 'question';
  return {
    delivered: true, conversation_session_id: conversation.recipientSessionId, intent, hop,
    note: `Sent to ${recipient.name}. ${ASYNC_NOTE}`
      + (returns ? ' Its answer arrives later as a new message from that agent.' : ''),
  };
}

/** The answer text of a finished turn: its last written text, else why there is none. */
function answerText(entry: MessageWithParts | undefined, message: AssistantMessage): string {
  const text = entry?.parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').filter(Boolean).pop()?.trim() ?? '';
  if (text) return text;
  if (message.status === 'error') return message.error ? `The turn failed: ${message.error}` : 'The turn failed without an answer.';
  if (message.status === 'interrupted') return 'The turn was interrupted before it answered.';
  return 'The turn ended without a written answer.';
}

/**
 * After a conversation's turn ends: when that turn was woken by a request or
 * a question and did not send an explicit result, its final text goes back
 * to the sender session as a result, one hop further. A failed turn returns
 * its error, so the sender is never left waiting. Any other turn (the
 * person's, a status, an FYI) returns nothing.
 */
export async function autoReturnAfterTurn(
  message: AssistantMessage,
  deps: Pick<MessagingServiceDeps, 'getPreconfigOrAgent' | 'readTranscript' | 'host'>,
): Promise<'delivered' | 'skipped'> {
  if (message.role !== 'assistant' || message.status === 'streaming') return 'skipped';
  const conversation = deps.host.conversations.findByRecipientSession(message.sessionId);
  if (!conversation) return 'skipped';
  const transcript = await deps.readTranscript(message.sessionId);
  const woken = latestWake(transcript, message.id);
  if (!woken || (woken.wake.intent !== 'request' && woken.wake.intent !== 'question')) return 'skipped';
  if (conversation.explicitResultWakeId === woken.messageId) return 'skipped';
  const hop = woken.wake.hop + 1;
  if (hop > deps.host.maxHops()) {
    console.warn('[agent-messaging] answer not returned: hop limit', { sessionId: message.sessionId, hop });
    return 'skipped';
  }
  const recipient = await deps.getPreconfigOrAgent(conversation.recipientAgentId);
  const entry = transcript.find((candidate) => candidate.message.id === message.id);
  await deps.host.deliver({
    sessionId: conversation.senderSessionId,
    content: formatAgentMessageWake({
      fromAgentId: conversation.recipientAgentId,
      fromName: recipient?.name ?? conversation.recipientAgentId,
      fromSessionId: message.sessionId,
      intent: 'result',
      hop,
      message: answerText(entry, message),
    }),
    key: `agent-return:${message.id}`,
  });
  return 'delivered';
}
