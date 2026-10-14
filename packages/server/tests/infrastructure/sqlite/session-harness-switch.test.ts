import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { createTestAssistantMessage, createTestSession, createTestTextPart, createTestToolPart, createTestUserMessage } from '#tests/helpers/factories';
import { seedWorkspace } from '#tests/seed';
import { HARNESS_SWITCH_FORK_REASON, HARNESS_SWITCH_PRIOR_EDIT_REASON } from '@prokopai/core/domains/sessions/harness-state';
import { forkSession } from '@prokopai/agent/internal/harnesses/prokop/execution/fork';
import { revertCrossesHarnessSwitch, revertToStep } from '@prokopai/agent/internal/harnesses/prokop/execution/revert';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { buildEffectiveContextHistory, createMessage, createPart } from '@/infrastructure/sqlite/message-store';
import { getHandoffSegment, switchSessionHarnessModel } from '@/infrastructure/sqlite/session-harness-switch';
import { createSession, getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { insertLegacyRow, legacyRow, pick } from '#tests/helpers/legacy-native';

beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws1' });
});
afterEach(resetTestDatabase);

const codex = { harness: 'codex-cli', modelId: 'gpt-5', effort: 'high' } as const;
const claude = { harness: 'claude-cli', modelId: 'sonnet', effort: 'medium' } as const;
const prokop = { harness: 'prokop', modelId: 'prokop-model', providerId: 'provider' } as const;

let clock = 1_000;

function makeSession(id: string, harness: 'prokop' | 'codex-cli' | 'claude-cli' = 'claude-cli') {
  const { createdAt: _created, updatedAt: _updated, ...session } = createTestSession({
    id, workspaceId: 'ws1', title: id, status: 'active',
  });
  return createSession({ ...session, harness });
}

function turn(sessionId: string, prompt: string, reply: string) {
  const user = createMessage(createTestUserMessage(sessionId, { createdAt: clock++ }));
  createPart(createTestTextPart(user.id, prompt), sessionId);
  const assistant = createMessage(createTestAssistantMessage(sessionId, { createdAt: clock++, modelId: 'sonnet' }));
  createPart(createTestToolPart(assistant.id, { name: 'Bash',
    state: { status: 'completed', input: { command: 'npm test' }, output: 'ok', startedAt: 1, completedAt: 2 } }), sessionId);
  createPart(createTestTextPart(assistant.id, reply), sessionId);
  return { user, assistant };
}

function bindClaude(sessionId: string, pending = 0) {
  insertLegacyRow('claude_session_bindings', { session_id: sessionId, native_session_id: `native-${sessionId}`,
    workspace_root: '/root', cli_version: '1.0', pending });
  insertLegacyRow('claude_session_models', { session_id: sessionId, model: 'sonnet', effort: 'high' });
}

test('switches a used Claude session to Codex, detaching the native thread and storing a brief', () => {
  makeSession('s');
  const { assistant } = turn('s', 'Fix the login bug', 'Fixed the token check.');
  bindClaude('s');
  const before = updateSession('s', { metadata: { claudeCompactedAt: 5, claudeCompactedAfterMessageId: 'old',
    claudeUsage: { last: {} }, keep: true } })!;

  const result = switchSessionHarnessModel('s', 'claude-cli', before.updatedAt, codex);
  expect(result.ok).toBe(true);
  const session = getSession('s')!;
  expect(session).toMatchObject({ harness: 'codex-cli', selectedModel: 'gpt-5', selectedVariant: null });
  expect(session.metadata).toEqual({ claudeCompactedAfterMessageId: 'old', keep: true });
  expect(session.harnessSwitches).toEqual([{ from: 'claude-cli', to: 'codex-cli', modelId: 'gpt-5',
    afterMessageId: assistant.id, createdAt: expect.any(String) }]);
  expect(session.harnessState?.fork).toEqual({ mode: 'restricted', reason: HARNESS_SWITCH_FORK_REASON });

  expect(legacyRow('claude_session_bindings', 's')).toBeNull();
  expect(legacyRow('claude_session_models', 's')).toBeNull();
  expect(pick(legacyRow('codex_session_models', 's'), ['model', 'effort']))
    .toEqual({ model: 'gpt-5', effort: 'high' });
  const segment = getHandoffSegment('s')!;
  expect(segment.afterMessageId).toBe(assistant.id);
  expect(segment.brief).toContain('started in Claude Code (sonnet) and now continues in Codex CLI');
  expect(segment.brief).toContain('Fix the login bug');
  expect(segment.brief).toContain('- tool Bash: {"command":"npm test"} (completed)');
});

test('switching again records both switches and replaces the brief', () => {
  makeSession('s');
  turn('s', 'first', 'one');
  const first = switchSessionHarnessModel('s', 'claude-cli', getSession('s')!.updatedAt, codex);
  expect(first.ok).toBe(true);
  const { assistant } = turn('s', 'second', 'two');
  const back = switchSessionHarnessModel('s', 'codex-cli', getSession('s')!.updatedAt, claude);
  expect(back.ok).toBe(true);
  expect(getSession('s')!.harnessSwitches?.map(entry => [entry.from, entry.to]))
    .toEqual([['claude-cli', 'codex-cli'], ['codex-cli', 'claude-cli']]);
  expect(getHandoffSegment('s')).toMatchObject({ afterMessageId: assistant.id });
  expect(getHandoffSegment('s')!.brief).toContain('second');
});

test('an empty session keeps the plain selection without a switch record', () => {
  const session = makeSession('empty', 'prokop');
  const result = switchSessionHarnessModel('empty', 'prokop', session.updatedAt, codex);
  expect(result).toMatchObject({ ok: true, session: { harness: 'codex-cli', harnessSwitches: [] } });
  expect(getHandoffSegment('empty')).toBeNull();
});

test('rejects stale, busy, queued, pending, recovering, and goal sessions', () => {
  const reject = (id: string, prepare: (sessionId: string) => void, message?: string) => {
    makeSession(id);
    turn(id, 'prompt', 'reply');
    prepare(id);
    const current = getSession(id)!;
    const result = switchSessionHarnessModel(id, 'claude-cli', current.updatedAt, codex);
    expect(result.ok).toBe(false);
    if (message && !result.ok) expect(result.message).toContain(message);
    expect(getSession(id)!.harness).toBe('claude-cli');
  };
  makeSession('stale');
  turn('stale', 'p', 'r');
  expect(switchSessionHarnessModel('stale', 'claude-cli', 'older', codex).ok).toBe(false);
  expect(switchSessionHarnessModel('stale', 'prokop', getSession('stale')!.updatedAt, codex).ok).toBe(false);

  reject('running', id => updateSession(id, { runningAt: new Date().toISOString() }), 'idle');
  reject('queued', id => getDatabase().run(`INSERT INTO queued_messages (id, session_id, content, position, created_at)
    VALUES ('q', ?, 'hi', 1, 1)`, [id]), 'queued');
  reject('ask', id => getDatabase().run(`INSERT INTO pending_asks (id, session_id, tool_call_id, tool_name, ask_json, created_at)
    VALUES ('a', ?, 'c', 'bash', '{}', 1)`, [id]), 'approvals');
  reject('pending', id => bindClaude(id, 1), 'recovery');
  reject('intent', id => insertLegacyRow('claude_rollback_intents', { session_id: id, operation: 'revert',
    target_message_id: 'x', phase: 'ready' }), 'recovery');
  reject('goal', id => updateSession(id, { metadata: { claudeGoal: { status: 'active', condition: 'x' } } }), 'Goal');
  reject('streaming', id => createMessage(createTestAssistantMessage(id, { status: 'streaming', createdAt: clock++ })), 'idle');
});

test('a resolved approval does not block the switch', () => {
  makeSession('s');
  turn('s', 'p', 'r');
  getDatabase().run(`INSERT INTO pending_asks (id, session_id, tool_call_id, tool_name, ask_json, created_at, status)
    VALUES ('a', 's', 'c', 'bash', '{}', 1, 'resolved')`);
  expect(switchSessionHarnessModel('s', 'claude-cli', getSession('s')!.updatedAt, codex).ok).toBe(true);
});

test('Prokop history after a switch holds only the new segment and carries the brief', async () => {
  makeSession('s');
  turn('s', 'before switch', 'old reply');
  expect(switchSessionHarnessModel('s', 'claude-cli', getSession('s')!.updatedAt, prokop).ok).toBe(true);
  expect(buildEffectiveContextHistory('s').messages).toEqual([]);
  const { user, assistant } = turn('s', 'after switch', 'new reply');
  const history = buildEffectiveContextHistory('s');
  expect(history.messages.map(entry => entry.message.id)).toEqual([user.id, assistant.id]);
  expect(history.handoffBrief).toContain('before switch');
  expect(history.hasCompaction).toBe(false);
});

test('Prokop Edit and Undo stay inside the current segment; fork is restricted', async () => {
  makeSession('s');
  const old = turn('s', 'before', 'old');
  expect(switchSessionHarnessModel('s', 'claude-cli', getSession('s')!.updatedAt, prokop).ok).toBe(true);
  const fresh = turn('s', 'after', 'new');

  expect(await revertCrossesHarnessSwitch('s', old.user.id, false)).toBe(true);
  expect(await revertCrossesHarnessSwitch('s', old.assistant.id, true)).toBe(true);
  expect(await revertCrossesHarnessSwitch('s', fresh.user.id, true)).toBe(false);
  await expect(revertToStep({ sessionId: 's', targetMessageId: old.user.id })).rejects.toThrow(HARNESS_SWITCH_PRIOR_EDIT_REASON);
  await expect(forkSession({ sessionId: 's', targetMessageId: fresh.assistant.id })).rejects.toThrow(HARNESS_SWITCH_FORK_REASON);

  // Undo at the switch boundary removes the whole new segment and keeps the old turns.
  const result = await revertToStep({ sessionId: 's', targetMessageId: old.assistant.id });
  expect(result.removed.messageIds).toEqual([fresh.user.id, fresh.assistant.id]);
  expect(getHandoffSegment('s')?.afterMessageId).toBe(old.assistant.id);
});
