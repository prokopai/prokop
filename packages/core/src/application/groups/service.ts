/**
 * Group chats between the person and their agents: one shared thread, each
 * member answering from its own hidden member session on its own harness.
 * The person's posts and membership changes come through HTTP; a member's
 * finished turn is copied in by the host's terminal-message hook; the
 * model-facing tools (`group_history`, `handoff_to_agent`) call the same
 * instance. Every wake goes through the host's delivery primitive, so a
 * member's harness changes nothing here.
 */

import { randomUUID } from 'node:crypto';
import {
  orderGroupThread,
  resolveToolSummary,
  type AgentGroup,
  type AgentGroupMessage,
  type AssistantMessage,
  type MessageWithParts,
  type Part,
  type PermissionMode,
  type Preconfig,
  type ServerMessage,
  type Session,
  type SessionHarness,
  type ToolPart,
} from '@prokopai/sdk';
import type { AgentGroupMemberRecord, AgentGroupRecord, AgentGroupStore } from '../ports/agent-groups';
import { explicitGroupTargets, resolveGroupTargets } from '../../domains/groups/routing';
import {
  capCatchUp,
  currentTurnReplyId,
  formatGroupWake,
  GROUP_CATCH_UP_MAX_MESSAGES,
  groupMessageLabel,
  groupMessageText,
  latestGroupWake,
  type GroupRosterEntry,
} from '../../domains/groups/wake';

export const GROUP_MIN_MEMBERS = 2;
export const GROUP_MAX_MEMBERS = 10;
export const GROUP_NAME_MAX_LENGTH = 80;
/** A post by the person. */
export const GROUP_POST_MAX_LENGTH = 20_000;
/** A handoff's message, like an agent message. */
export const GROUP_HANDOFF_MAX_LENGTH = 8_000;
export const GROUP_HISTORY_DEFAULT_LIMIT = 20;
export const GROUP_HISTORY_MAX_LIMIT = 50;
const PERMISSION_MODES: readonly PermissionMode[] = ['standard', 'extended', 'full'];

export interface AgentGroupsServiceDeps {
  store: AgentGroupStore;
  sessions: {
    getSession(id: string): Session | null;
    createSession(input: Omit<Session, 'createdAt' | 'updatedAt'>): Session;
    deleteSession(id: string): void;
    /** The group's mode onto a member session; the session's own setting is never the source. */
    setPermissionMode(id: string, mode: PermissionMode): void;
    getMessageWithParts(sessionId: string, messageId: string): Promise<MessageWithParts | null>;
    listTranscript(sessionId: string): Promise<MessageWithParts[]>;
  };
  getPreconfigOrAgent(id: string): Promise<Preconfig | null>;
  /** Tool summary templates by tool name, from the tool catalog; a mirrored tool call shows this line. */
  toolSummaryTemplates?(): Promise<ReadonlyMap<string, string>>;
  /** Puts a message in front of a member session's model (the delivery primitive). */
  deliver(input: { sessionId: string; content: string; key: string }): Promise<void>;
  /** Pins a CLI member session's model the way a new session gets it; no-op for Prokop. */
  pinModel(input: { sessionId: string; harness: SessionHarness; model: string | null; variant: string | null }): Promise<void>;
  maxHops(): number;
  interrupt(sessionId: string, reason: string): Promise<void>;
  stopBackgroundWork?(sessionId: string): void;
  broadcast(message: ServerMessage): void;
  now?(): string;
}

export type GroupFailure =
  | 'not_found' | 'invalid' | 'agent_not_found' | 'too_many_members' | 'too_few_members'
  | 'already_member' | 'not_member' | 'hop_limit' | 'self_handoff' | 'message_too_long';

export type GroupResult<T> = { ok: true; value: T } | { ok: false; code: GroupFailure; error: string };

export interface GroupHistoryEntry {
  seq: number;
  /** `[Name]`, `[User]`, `[Name → Other, handoff]`, `[system]`. */
  author: string;
  kind: AgentGroupMessage['authorKind'];
  text: string;
  created_at: string;
}

export interface GroupHistoryOutput {
  group: string;
  messages: GroupHistoryEntry[];
  has_more: boolean;
}

export interface GroupMembership {
  group: AgentGroupRecord;
  member: AgentGroupMemberRecord;
  /** The other members, for tool descriptions. */
  others: GroupRosterEntry[];
}

export interface AgentGroupsService {
  create(input: { workspaceId: string; name: string; memberAgentIds: readonly string[]; defaultAgentId?: string | null; permissionMode?: PermissionMode }): Promise<GroupResult<AgentGroup>>;
  get(id: string): Promise<AgentGroup | null>;
  list(workspaceId: string): Promise<AgentGroup[]>;
  /** A new permission mode lands on every member session. */
  update(id: string, patch: { name?: string; defaultAgentId?: string; permissionMode?: PermissionMode }): Promise<GroupResult<AgentGroup>>;
  addMember(id: string, agentId: string): Promise<GroupResult<AgentGroup>>;
  removeMember(id: string, agentId: string): Promise<GroupResult<AgentGroup>>;
  /** Deletes the group and every member session (running turns stopped). */
  remove(id: string): Promise<GroupResult<{ id: string; workspaceId: string }>>;
  /** The person posts; the members it names (or the default member) are woken. */
  postUserMessage(id: string, input: { text: string; mentions?: readonly string[] }): Promise<GroupResult<{ message: AgentGroupMessage; woken: string[] }>>;
  /** The newest `limit` messages before `beforeSeq`, oldest first. */
  listMessages(id: string, query: { beforeSeq?: number; limit?: number }): GroupResult<{ messages: AgentGroupMessage[]; hasMore: boolean }>;
  /** The group a session answers for, or null for any other session. */
  memberOf(sessionId: string): Promise<GroupMembership | null>;
  history(sessionId: string, input: { before_seq?: unknown; after_seq?: unknown; limit?: unknown }): Promise<GroupResult<GroupHistoryOutput>>;
  handoff(sessionId: string, input: { agent_id?: unknown; message?: unknown }): Promise<GroupResult<{ target: string; hop: number; seq: number; note: string }>>;
  /** A member session's finished reply becomes a group message by that member. */
  mirrorFinishedTurn(message: AssistantMessage): Promise<'mirrored' | 'skipped'>;
}

function fail<T>(code: GroupFailure, error: string): GroupResult<T> {
  return { ok: false, code, error };
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === null) return fallback;
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(number)) return null;
  return Math.min(max, Math.max(min, number));
}

export function createAgentGroupsService(deps: AgentGroupsServiceDeps): AgentGroupsService {
  const { store } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  const textPart = (messageId: string, text: string): Part =>
    ({ id: randomUUID(), messageId, createdAt: Date.now(), type: 'text', text });

  async function agentsOf(ids: readonly string[]): Promise<Map<string, Preconfig>> {
    const result = new Map<string, Preconfig>();
    for (const id of new Set(ids)) {
      const agent = await deps.getPreconfigOrAgent(id);
      if (agent) result.set(id, agent);
    }
    return result;
  }

  async function names(group: AgentGroupRecord, extra: readonly (string | null)[] = []): Promise<Map<string, string>> {
    const ids = [...store.listMembers(group.id).map((member) => member.agentId), ...extra.filter((id): id is string => !!id)];
    const agents = await agentsOf(ids);
    return new Map(ids.map((id) => [id, agents.get(id)?.name ?? id]));
  }

  async function roster(group: AgentGroupRecord, except?: string): Promise<GroupRosterEntry[]> {
    const members = store.listMembers(group.id).filter((member) => member.agentId !== except);
    const agents = await agentsOf(members.map((member) => member.agentId));
    return members.map((member) => {
      const agent = agents.get(member.agentId);
      return { agentId: member.agentId, name: agent?.name ?? member.agentId, description: agent?.description ?? '' };
    });
  }

  async function view(group: AgentGroupRecord): Promise<AgentGroup> {
    const members = store.listMembers(group.id);
    const agents = await agentsOf(members.map((member) => member.agentId));
    return {
      id: group.id,
      workspaceId: group.workspaceId,
      name: group.name,
      defaultAgentId: group.defaultAgentId,
      permissionMode: group.permissionMode,
      members: members.map((member) => ({
        agentId: member.agentId,
        name: agents.get(member.agentId)?.name ?? member.agentId,
        sessionId: member.memberSessionId,
        cursorSeq: member.cursorSeq,
        joinedAt: member.joinedAt,
      })),
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  async function announce(group: AgentGroupRecord): Promise<AgentGroup> {
    const current = store.getGroup(group.id) ?? group;
    const result = await view(current);
    deps.broadcast({ type: 'group.updated', group: result });
    return result;
  }

  function touch(groupId: string): void {
    store.updateGroup(groupId, { updatedAt: now() });
  }

  function append(message: Omit<AgentGroupMessage, 'seq'>): AgentGroupMessage {
    const stored = store.appendMessage(message);
    touch(message.groupId);
    deps.broadcast({ type: 'group.message.created', message: stored });
    return stored;
  }

  function post(group: AgentGroupRecord, fields: Pick<AgentGroupMessage, 'authorKind' | 'authorAgentId' | 'targetAgentId' | 'hop'>, text: string, sourceMessageId: string | null = null): AgentGroupMessage {
    const id = randomUUID();
    return append({ id, groupId: group.id, ...fields, sourceMessageId, parts: [textPart(id, text)], createdAt: now() });
  }

  function createMemberSession(group: AgentGroupRecord, agent: Preconfig): Session {
    const session = deps.sessions.createSession({
      id: randomUUID(),
      workspaceId: group.workspaceId,
      workspaceRootId: null,
      preconfigId: agent.id,
      agentId: agent.id,
      agentName: agent.name,
      title: `${group.name}: ${agent.name}`,
      status: 'active',
      permissionMode: group.permissionMode,
      // The marker the session lists hide on and the tools look up membership by.
      metadata: { groupMember: { groupId: group.id, agentId: agent.id } },
      parentId: null,
      harness: agent.modelHarness ?? 'prokop',
      selectedModel: agent.model,
      selectedProvider: agent.provider,
      selectedVariant: agent.variant ?? null,
    });
    deps.broadcast({ type: 'session.created', session });
    return session;
  }

  function deleteMemberSession(sessionId: string, reason: string): void {
    if (!deps.sessions.getSession(sessionId)) return;
    void deps.interrupt(sessionId, reason).catch(() => undefined);
    deps.stopBackgroundWork?.(sessionId);
    deps.sessions.deleteSession(sessionId);
    deps.broadcast({ type: 'session.deleted', sessionId });
  }

  /**
   * Sends a member everything after its cursor (its own messages left out),
   * capped, with the roster when it is new to it, then moves the cursor to
   * the newest message. Nothing new means no wake.
   */
  async function wake(group: AgentGroupRecord, member: AgentGroupMemberRecord, hop: number, reason: string): Promise<boolean> {
    const range = { afterSeq: member.cursorSeq, excludeAuthorAgentId: member.agentId };
    const total = store.countMessages(group.id, range);
    if (total === 0) return false;
    const agent = await deps.getPreconfigOrAgent(member.agentId);
    const candidates = store.listMessages(group.id, { ...range, limit: GROUP_CATCH_UP_MAX_MESSAGES + 1 });
    const capped = capCatchUp(candidates, await names(group, candidates.flatMap((message) => [message.authorAgentId, message.targetAgentId])));
    capped.omitted = total - capped.lines.length;
    const latest = store.latestSeq(group.id);
    const content = formatGroupWake({
      group: { id: group.id, name: group.name },
      member: { agentId: member.agentId, name: agent?.name ?? member.agentId },
      roster: member.rosterVersion < group.membershipVersion ? await roster(group) : null,
      catchUp: capped,
      hop,
      reason,
    });
    // A member session deleted behind the group's back is replaced, so the group heals itself.
    let session = deps.sessions.getSession(member.memberSessionId);
    if (!session && agent) {
      session = createMemberSession(group, agent);
      store.updateMember(group.id, member.agentId, { memberSessionId: session.id });
    }
    if (!session) return false;
    store.updateMember(group.id, member.agentId, { cursorSeq: latest, rosterVersion: group.membershipVersion });
    await deps.pinModel({ sessionId: session.id, harness: session.harness ?? 'prokop', model: agent?.model ?? null, variant: agent?.variant ?? null });
    await deps.deliver({ sessionId: session.id, content, key: `group-wake:${group.id}:${member.agentId}:${latest}` });
    return true;
  }

  async function wakeAll(group: AgentGroupRecord, agentIds: readonly string[], hop: number, reason: string): Promise<string[]> {
    const members = store.listMembers(group.id);
    const woken: string[] = [];
    for (const agentId of agentIds) {
      const member = members.find((candidate) => candidate.agentId === agentId);
      if (member && await wake(group, member, hop, reason)) woken.push(agentId);
    }
    return woken;
  }

  function hopOf(transcript: readonly MessageWithParts[], beforeMessageId?: string): number {
    return latestGroupWake(transcript, beforeMessageId)?.wake.hop ?? 0;
  }

  /** What the group keeps of a finished turn: text in full, each tool call as name, status and summary. */
  async function mirroredParts(entry: MessageWithParts | null, message: AssistantMessage, groupMessageId: string): Promise<Part[]> {
    const templates = (await deps.toolSummaryTemplates?.()) ?? new Map<string, string>();
    const parts: Part[] = [];
    for (const part of entry?.parts ?? []) {
      if (part.type === 'text') {
        if (part.text.trim()) parts.push({ ...textPart(groupMessageId, part.text), createdAt: part.createdAt });
      } else if (part.type === 'tool') {
        parts.push(strippedTool(part, groupMessageId, templates));
      }
    }
    if (parts.length === 0) {
      if (message.status === 'error') parts.push(textPart(groupMessageId, message.error ? `The turn failed: ${message.error}` : 'The turn failed without an answer.'));
      else if (message.status === 'interrupted') parts.push(textPart(groupMessageId, 'The turn was interrupted before it answered.'));
    }
    return parts;
  }

  function strippedTool(part: ToolPart, groupMessageId: string, templates: ReadonlyMap<string, string>): ToolPart {
    const summary = part.presentation?.summary || resolveToolSummary(part.state.input, templates.get(part.name));
    const startedAt = 'startedAt' in part.state ? part.state.startedAt : part.createdAt;
    const state: ToolPart['state'] = part.state.status === 'error'
      ? { status: 'error', input: {}, error: part.state.error, startedAt, failedAt: part.state.failedAt }
      : part.state.status === 'interrupted'
        ? { status: 'interrupted', input: {}, startedAt, interruptedAt: part.state.interruptedAt, reason: part.state.reason }
        : { status: 'completed', input: {}, output: null, startedAt, completedAt: part.state.status === 'completed' ? part.state.completedAt : startedAt };
    return { id: randomUUID(), messageId: groupMessageId, createdAt: part.createdAt, type: 'tool', callId: part.callId, name: part.name, state,
      presentation: { summary, debugAvailable: false } };
  }

  async function membership(sessionId: string): Promise<GroupMembership | null> {
    const member = store.findMemberBySession(sessionId);
    const group = member ? store.getGroup(member.groupId) : null;
    if (!member || !group) return null;
    return { group, member, others: await roster(group, member.agentId) };
  }

  const service: AgentGroupsService = {
    async create(input) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) return fail('invalid', 'A group needs a name');
      if (name.length > GROUP_NAME_MAX_LENGTH) return fail('invalid', `The name is over ${GROUP_NAME_MAX_LENGTH} characters`);
      const ids = [...new Set((input.memberAgentIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))];
      if (ids.length < GROUP_MIN_MEMBERS) return fail('too_few_members', `A group needs at least ${GROUP_MIN_MEMBERS} members`);
      if (ids.length > GROUP_MAX_MEMBERS) return fail('too_many_members', `A group has at most ${GROUP_MAX_MEMBERS} members`);
      const agents = await agentsOf(ids);
      const missing = ids.find((id) => !agents.has(id));
      if (missing) return fail('agent_not_found', `No agent "${missing}"`);
      const defaultAgentId = input.defaultAgentId?.trim() || ids[0]!;
      if (!ids.includes(defaultAgentId)) return fail('invalid', 'The default member must be a member');
      const permissionMode = input.permissionMode ?? 'standard';
      if (!PERMISSION_MODES.includes(permissionMode)) return fail('invalid', `permissionMode must be one of ${PERMISSION_MODES.join(', ')}`);

      const timestamp = now();
      const group: AgentGroupRecord = {
        id: randomUUID(), workspaceId: input.workspaceId, name, defaultAgentId, permissionMode, membershipVersion: 1, createdAt: timestamp, updatedAt: timestamp,
      };
      store.insertGroup(group);
      for (const id of ids) {
        const session = createMemberSession(group, agents.get(id)!);
        store.upsertMember({ groupId: group.id, agentId: id, memberSessionId: session.id, cursorSeq: 0, rosterVersion: 0, joinedAt: timestamp });
      }
      return { ok: true, value: await announce(group) };
    },

    async get(id) {
      const group = store.getGroup(id);
      return group ? view(group) : null;
    },

    async list(workspaceId) {
      const groups: AgentGroup[] = [];
      for (const group of store.listGroups(workspaceId)) groups.push(await view(group));
      return groups;
    },

    async update(id, patch) {
      const group = store.getGroup(id);
      if (!group) return fail('not_found', 'Group not found');
      const changes: { name?: string; defaultAgentId?: string; permissionMode?: PermissionMode } = {};
      if (patch.permissionMode !== undefined) {
        if (!PERMISSION_MODES.includes(patch.permissionMode)) return fail('invalid', `permissionMode must be one of ${PERMISSION_MODES.join(', ')}`);
        if (patch.permissionMode !== group.permissionMode) changes.permissionMode = patch.permissionMode;
      }
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) return fail('invalid', 'A group needs a name');
        if (name.length > GROUP_NAME_MAX_LENGTH) return fail('invalid', `The name is over ${GROUP_NAME_MAX_LENGTH} characters`);
        changes.name = name;
      }
      if (patch.defaultAgentId !== undefined) {
        if (!store.listMembers(id).some((member) => member.agentId === patch.defaultAgentId)) return fail('not_member', 'The default member must be a member');
        changes.defaultAgentId = patch.defaultAgentId;
      }
      store.updateGroup(id, { ...changes, updatedAt: now() });
      // The mode is one setting for the whole group: every member session follows it at once.
      if (changes.permissionMode) {
        for (const member of store.listMembers(id)) deps.sessions.setPermissionMode(member.memberSessionId, changes.permissionMode);
      }
      return { ok: true, value: await announce(group) };
    },

    async addMember(id, agentId) {
      const group = store.getGroup(id);
      if (!group) return fail('not_found', 'Group not found');
      const members = store.listMembers(id);
      if (members.some((member) => member.agentId === agentId)) return fail('already_member', `${agentId} is already a member`);
      if (members.length >= GROUP_MAX_MEMBERS) return fail('too_many_members', `A group has at most ${GROUP_MAX_MEMBERS} members`);
      const agent = await deps.getPreconfigOrAgent(agentId);
      if (!agent) return fail('agent_not_found', `No agent "${agentId}"`);
      const session = createMemberSession(group, agent);
      // A new member starts from now; group_history reads what came before.
      store.upsertMember({ groupId: id, agentId, memberSessionId: session.id, cursorSeq: store.latestSeq(id), rosterVersion: 0, joinedAt: now() });
      store.updateGroup(id, { membershipVersion: group.membershipVersion + 1, updatedAt: now() });
      post(store.getGroup(id)!, { authorKind: 'system', authorAgentId: null, targetAgentId: null, hop: 0 }, `${agent.name} joined the group.`);
      return { ok: true, value: await announce(group) };
    },

    async removeMember(id, agentId) {
      const group = store.getGroup(id);
      if (!group) return fail('not_found', 'Group not found');
      const members = store.listMembers(id);
      const member = members.find((candidate) => candidate.agentId === agentId);
      if (!member) return fail('not_member', `${agentId} is not a member`);
      if (members.length <= GROUP_MIN_MEMBERS) return fail('too_few_members', `A group keeps at least ${GROUP_MIN_MEMBERS} members; delete the group instead`);
      deleteMemberSession(member.memberSessionId, 'Removed from the group');
      store.deleteMember(id, agentId);
      const remaining = members.filter((candidate) => candidate.agentId !== agentId);
      store.updateGroup(id, {
        membershipVersion: group.membershipVersion + 1,
        updatedAt: now(),
        ...(group.defaultAgentId === agentId ? { defaultAgentId: remaining[0]!.agentId } : {}),
      });
      const agent = await deps.getPreconfigOrAgent(agentId);
      post(store.getGroup(id)!, { authorKind: 'system', authorAgentId: null, targetAgentId: null, hop: 0 }, `${agent?.name ?? agentId} left the group.`);
      return { ok: true, value: await announce(group) };
    },

    async remove(id) {
      const group = store.getGroup(id);
      if (!group) return fail('not_found', 'Group not found');
      for (const member of store.listMembers(id)) deleteMemberSession(member.memberSessionId, 'Group deleted');
      store.deleteGroup(id);
      deps.broadcast({ type: 'group.deleted', groupId: id, workspaceId: group.workspaceId });
      return { ok: true, value: { id, workspaceId: group.workspaceId } };
    },

    async postUserMessage(id, input) {
      const group = store.getGroup(id);
      if (!group) return fail('not_found', 'Group not found');
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) return fail('invalid', 'The message is empty');
      if (text.length > GROUP_POST_MAX_LENGTH) return fail('message_too_long', `The message is ${text.length} characters; the limit is ${GROUP_POST_MAX_LENGTH}`);
      const members = store.listMembers(id);
      const agents = await agentsOf(members.map((member) => member.agentId));
      const routing = members.map((member) => ({ agentId: member.agentId, name: agents.get(member.agentId)?.name ?? member.agentId }));
      const message = post(group, { authorKind: 'user', authorAgentId: null, targetAgentId: null, hop: 0 }, text);
      const explicit = explicitGroupTargets(text, input.mentions ?? [], routing);
      const targets = resolveGroupTargets(text, input.mentions ?? [], routing, group.defaultAgentId);
      const woken = await wakeAll(group, targets, 0, explicit.length > 0 ? 'mentioned' : 'default member');
      return { ok: true, value: { message, woken } };
    },

    listMessages(id, query) {
      const group = store.getGroup(id);
      if (!group) return fail('not_found', 'Group not found');
      const limit = clampInteger(query.limit, GROUP_HISTORY_MAX_LIMIT, 1, 200);
      if (limit === null) return fail('invalid', 'limit must be an integer');
      const beforeSeq = query.beforeSeq === undefined ? undefined : clampInteger(query.beforeSeq, 0, 0, Number.MAX_SAFE_INTEGER);
      if (beforeSeq === null) return fail('invalid', 'beforeSeq must be an integer');
      const range = beforeSeq === undefined ? {} : { beforeSeq };
      const messages = store.listMessages(id, { ...range, limit });
      const hasMore = messages.length > 0 && store.countMessages(id, { beforeSeq: messages[0]!.seq }) > 0;
      return { ok: true, value: { messages, hasMore } };
    },

    memberOf: membership,

    async history(sessionId, input) {
      const found = await membership(sessionId);
      if (!found) return fail('not_member', 'This session is not in a group');
      const limit = clampInteger(input.limit, GROUP_HISTORY_DEFAULT_LIMIT, 1, GROUP_HISTORY_MAX_LIMIT);
      const beforeSeq = clampInteger(input.before_seq, -1, 0, Number.MAX_SAFE_INTEGER);
      const afterSeq = clampInteger(input.after_seq, -1, 0, Number.MAX_SAFE_INTEGER);
      if (limit === null || beforeSeq === null || afterSeq === null) return fail('invalid', 'before_seq, after_seq and limit must be integers');
      if (beforeSeq >= 0 && afterSeq >= 0) return fail('invalid', 'Give before_seq or after_seq, not both');
      const { group } = found;
      const query = afterSeq >= 0
        ? { afterSeq, limit, take: 'oldest' as const }
        : { beforeSeq: beforeSeq >= 0 ? beforeSeq : store.latestSeq(group.id) + 1, limit };
      // The window is by seq; within it the messages read as the thread does.
      const messages = store.listMessages(group.id, query);
      const labels = await names(group, messages.flatMap((message) => [message.authorAgentId, message.targetAgentId]));
      const hasMore = messages.length > 0 && (afterSeq >= 0
        ? store.countMessages(group.id, { afterSeq: messages.at(-1)!.seq }) > 0
        : store.countMessages(group.id, { beforeSeq: messages[0]!.seq }) > 0);
      return { ok: true, value: {
        group: group.name,
        messages: orderGroupThread(messages).map((message) => ({
          seq: message.seq, author: groupMessageLabel(message, labels), kind: message.authorKind, text: groupMessageText(message), created_at: message.createdAt,
        })),
        has_more: hasMore,
      } };
    },

    async handoff(sessionId, input) {
      const found = await membership(sessionId);
      if (!found) return fail('not_member', 'This session is not in a group');
      const { group, member } = found;
      const target = typeof input.agent_id === 'string' ? input.agent_id.trim() : '';
      if (!target) return fail('invalid', 'agent_id is required');
      const text = typeof input.message === 'string' ? input.message.trim() : '';
      if (!text) return fail('invalid', 'message is required');
      if (text.length > GROUP_HANDOFF_MAX_LENGTH) return fail('message_too_long', `message is ${text.length} characters; the limit is ${GROUP_HANDOFF_MAX_LENGTH}`);
      if (target === member.agentId) return fail('self_handoff', 'You cannot hand a stage to yourself');
      const recipient = store.listMembers(group.id).find((candidate) => candidate.agentId === target);
      if (!recipient) return fail('not_member', `${target} is not in this group; the members are ${found.others.map((other) => other.agentId).join(', ')}`);
      const transcript = await deps.sessions.listTranscript(sessionId);
      // The reply this turn is writing; the thread shows it ahead of the handoff, where the turn began.
      const replyId = currentTurnReplyId(transcript);
      const hop = hopOf(transcript, replyId ?? undefined) + 1;
      const maxHops = deps.maxHops();
      if (hop > maxHops) return fail('hop_limit', `This handoff would be hop ${hop}; handoffs stop at ${maxHops} hops from the user's message. Report to the user in the group instead.`);
      const labels = await names(group);
      const message = post(group, { authorKind: 'handoff', authorAgentId: member.agentId, targetAgentId: target, hop }, text, replyId);
      await wake(group, recipient, hop, `handoff from ${labels.get(member.agentId) ?? member.agentId}`);
      return { ok: true, value: { target, hop, seq: message.seq,
        note: `${labels.get(target) ?? target} now owns this stage and was woken with your message. Do not continue the stage yourself; your turn's final text still posts to the group.` } };
    },

    async mirrorFinishedTurn(message) {
      if (message.role !== 'assistant' || message.status === 'streaming') return 'skipped';
      if (message.summary || (message.mode && message.mode !== 'chat')) return 'skipped';
      const member = store.findMemberBySession(message.sessionId);
      const group = member ? store.getGroup(member.groupId) : null;
      if (!member || !group || store.hasSourceMessage(group.id, message.id)) return 'skipped';
      const [entry, transcript] = await Promise.all([
        deps.sessions.getMessageWithParts(message.sessionId, message.id),
        deps.sessions.listTranscript(message.sessionId),
      ]);
      const id = randomUUID();
      const parts = await mirroredParts(entry, message, id);
      if (parts.length === 0) return 'skipped';
      append({ id, groupId: group.id, authorKind: 'agent', authorAgentId: member.agentId, targetAgentId: null, sourceMessageId: message.id,
        parts, hop: hopOf(transcript, message.id), createdAt: now() });
      return 'mirrored';
    },
  };

  return service;
}
