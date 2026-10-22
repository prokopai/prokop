/**
 * Launches and asking the user: `isolation: 'worktree'` starts a top-level
 * session on a fresh branch and worktree, linked to the caller through the
 * task row; a free target outside the agent's allowed set and every launch
 * ask the user first; the finish note carries the branch and the changes.
 */

import { describe, expect, test } from 'bun:test';
import { createMemoryDelegatedTaskStore, type DelegationAskNotice } from '@prokopai/core/application/ports/delegation-host';
import type { HeadlessSessionRunInput } from '@prokopai/core/application/ports/headless-execution';
import type { MessageWithParts, PermissionAsk, Preconfig, Session, SessionHarness, TextPart } from '@prokopai/sdk/types';
import { createTaskRegistry } from '@prokopai/agent/internal/harnesses/prokop/subagent/task-registry';
import {
  delegationDecision,
  executeSubagentWithDeps,
  executeTaskCancel,
  executeTaskStatus,
  type SubagentServiceDeps,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/task-tool';

const DEV: Preconfig = {
  id: 'dev', name: 'Dev', description: 'Builds', systemPrompt: '', tools: null, model: null, provider: null,
  variant: null, settings: null, isDefault: false, mode: 'both', canSpawnSubagents: true, allowSelfAsSubagent: true,
};
const EXPLORE: Preconfig = { ...DEV, id: 'explore', name: 'Explore', description: 'Explores', mode: 'subagent' };

function session(overrides: Partial<Session>): Session {
  return {
    id: 'root', workspaceId: 'ws-1', preconfigId: 'dev', title: 'Root', status: 'active', metadata: null,
    createdAt: '', updatedAt: '', parentId: null, agentName: null, harness: 'prokop', selectedModel: 'm', selectedProvider: 'p',
    permissionMode: 'standard', ...overrides,
  } as Session;
}

function harness(options: { preconfigs?: Preconfig[]; answer?: (ask: PermissionAsk) => { approved: boolean; remember?: boolean }; noWorktrees?: boolean; currentBranch?: string | null } = {}) {
  const preconfigs = options.preconfigs ?? [DEV, EXPLORE];
  const sessions = new Map<string, Session>([['root', session({ id: 'root' })]]);
  const asks: PermissionAsk[] = [];
  const deliveries: Array<{ sessionId: string; content: string; key: string }> = [];
  const runs: HeadlessSessionRunInput[] = [];
  const created: Array<{ workspaceId: string; branch: string; baseBranch: string }> = [];
  const remembered: Array<[string, SessionHarness]> = [];
  const transcripts = new Map<string, MessageWithParts[]>();
  const tasks = createMemoryDelegatedTaskStore();
  const listeners = new Set<(ask: DelegationAskNotice) => void>();
  const worktrees = {
    currentBranch: async () => options.currentBranch === undefined ? 'main' : options.currentBranch,
    createWorktree: async (input: { workspaceId: string; branch: string; baseBranch: string }) => {
      created.push(input);
      const branch = created.filter((entry) => entry.branch === input.branch).length > 1 ? `${input.branch}-2` : input.branch;
      return { ok: true as const, worktreeId: `wt-${branch}`, path: `/data/worktrees/${branch}`, branch };
    },
    worktreeChanges: async (worktreeId: string) => ({ changedFiles: 3, branch: worktreeId.replace(/^wt-/, ''), path: `/data/worktrees/${worktreeId.replace(/^wt-/, '')}` }),
  };
  const host = {
    harnessEnabled: () => true,
    harnessAvailable: () => true,
    maxChildren: () => 4,
    maxLaunches: () => 2,
    interrupt: async () => {},
    deliver: async (input: { sessionId: string; content: string; key: string }) => { deliveries.push(input); },
    onAskCreated: (listener: (ask: DelegationAskNotice) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    hasPendingAsk: () => false,
    tasks,
    ...(options.noWorktrees ? {} : { worktrees }),
  };
  const getSession = (id: string) => sessions.get(id) ?? null;
  const readTranscript = async (id: string) => transcripts.get(id) ?? [];
  const registry = createTaskRegistry({ host, getSession, readTranscript });
  let finish: (text: string) => void = () => {};
  const done = new Promise<string>((resolve) => { finish = resolve; });
  const deps: SubagentServiceDeps = {
    sessionAccess: {
      getSession,
      createSession: (input) => { const s = { ...input, createdAt: '', updatedAt: '' } as Session; sessions.set(s.id, s); return s; },
      updateSession: (id, updates) => { const e = sessions.get(id); if (!e) return null; const u = { ...e, ...updates } as Session; sessions.set(id, u); return u; },
      getWorkspaceAutoApproveSeverity: async () => 'low',
      listChildSessions: (parentId) => [...sessions.values()].filter((s) => s.parentId === parentId),
    },
    preconfigs: {
      getPreconfigOrAgent: async (id) => preconfigs.find((p) => p.id === id) ?? null,
      listSubagentPreconfigs: async () => preconfigs.filter((p) => p.mode !== 'primary'),
      allowDelegationTarget: async (id, h) => { remembered.push([id, h]); },
    },
    broadcasts: { event: () => {}, sessionCreated: () => {}, sessionUpdated: () => {}, toSession: () => {} },
    executeChild: async () => ({ parts: [{ id: 'p', messageId: 'm', createdAt: 0, type: 'text', text: 'in-process' } as TextPart] }),
    runOnHarness: async (input) => {
      runs.push(input);
      const text = await done;
      transcripts.set(input.childSessionId, [{
        message: { id: 'a', sessionId: input.childSessionId, role: 'assistant', createdAt: 1 } as MessageWithParts['message'],
        parts: [{ id: 'pa', messageId: 'a', createdAt: 1, type: 'text', text } as TextPart],
      }]);
      return {};
    },
    readTranscript,
    host,
    catalog: { prokopModels: () => [{ id: 'm', name: 'M', providerId: 'p' }], harnessModels: async () => [] },
    maxChildren: () => 4,
    registry,
  };
  return { deps, sessions, asks, deliveries, runs, created, remembered, tasks, registry, finish: (t: string) => finish(t),
    ask: async (ask: PermissionAsk) => { asks.push(ask); return options.answer?.(ask) ?? { approved: true }; } };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
// Launches name a role like any delegation; DEV launches itself because it allows self-delegation.
const call =(overrides: Record<string, unknown>) => ({
  description: 'Add rate limiting', prompt: 'Implement it', subagent_type: 'dev', sessionId: 'root', workspaceId: 'ws-1', workspacePath: '/repo', ...overrides,
}) as Parameters<typeof executeSubagentWithDeps>[0];

describe('launches into worktrees', () => {
  test('a launch asks the user, creates a branch and worktree, starts a top-level session and reports with the branch', async () => {
    const h = harness();
    const result = await executeSubagentWithDeps(call({ isolation: 'worktree', mode: 'wait', ask: h.ask }), h.deps);

    expect(h.asks).toHaveLength(1);
    expect(h.asks[0]!.question).toBe('Start a session in a new worktree for "Add rate limiting"?');
    expect(h.asks[0]!.description).toContain('Role: dev');
    expect(h.asks[0]!.description).toContain('Branch: add-rate-limiting from main');
    expect(h.created).toEqual([{ workspaceId: 'ws-1', branch: 'add-rate-limiting', baseBranch: 'main' }]);

    // Async whatever the caller asked for; the session is top-level and bound to the worktree.
    expect(result).toMatchObject({ status: 'running', waitTimedOut: false });
    expect(result.result).toContain('top-level session in worktree /data/worktrees/add-rate-limiting on branch add-rate-limiting');
    const launched = h.sessions.get(result.task_id)!;
    expect(launched).toMatchObject({ parentId: null, workspaceRootId: 'wt-add-rate-limiting', title: 'Add rate limiting', preconfigId: 'dev', subagentStatus: 'running', permissionMode: 'standard' });
    expect(h.tasks.get(result.task_id)).toMatchObject({ kind: 'launch', worktreeId: 'wt-add-rate-limiting', branch: 'add-rate-limiting', watched: true });
    expect(h.runs[0]).toMatchObject({ harness: 'prokop', workspacePath: '/data/worktrees/add-rate-limiting', childSessionId: result.task_id });
    expect(h.runs[0]!.prompt).toStartWith('You work in a dedicated worktree at /data/worktrees/add-rate-limiting on branch add-rate-limiting');

    // Status and cancel resolve ownership through the row, not a parent chain.
    expect(await executeTaskStatus({ task_id: result.task_id, sessionId: 'root' }, h.deps)).toMatchObject({ status: 'running' });
    expect(await executeTaskStatus({ task_id: result.task_id, sessionId: 'stranger' }, h.deps)).toMatchObject({ code: 'task_not_found' });

    h.finish('Done: middleware added, tests pass.');
    await settle();
    expect(h.deliveries).toHaveLength(1);
    const note = h.deliveries[0]!.content;
    expect(note).toStartWith(`[launched session ${result.task_id} "Add rate limiting" on prokop/m finished]`);
    expect(note).toContain('Branch: add-rate-limiting\nWorktree: /data/worktrees/add-rate-limiting\nUncommitted changes: 3 files\nOpen that session to review and merge.');
    expect(note).toContain('Done: middleware added, tests pass.');
  });

  test('the user can decline, the agent can be forbidden, and the launch cap holds', async () => {
    const declined = harness({ answer: () => ({ approved: false }) });
    expect(await executeSubagentWithDeps(call({ isolation: 'worktree', ask: declined.ask }), declined.deps)).toMatchObject({ code: 'launch_not_allowed' });
    expect(declined.created).toEqual([]);

    const never = harness({ preconfigs: [{ ...DEV, launches: 'never' }, EXPLORE] });
    expect(await executeSubagentWithDeps(call({ isolation: 'worktree', ask: never.ask }), never.deps)).toMatchObject({ code: 'launch_not_allowed' });
    expect(never.asks).toEqual([]);

    const nobody = harness();
    expect(await executeSubagentWithDeps(call({ isolation: 'worktree' }), nobody.deps)).toMatchObject({ code: 'launch_not_allowed' });

    const allowed = harness({ preconfigs: [{ ...DEV, launches: 'allow' }, EXPLORE] });
    const first = await executeSubagentWithDeps(call({ isolation: 'worktree' }), allowed.deps);
    const second = await executeSubagentWithDeps(call({ isolation: 'worktree', description: 'Second' }), allowed.deps);
    expect(first.status).toBe('running');
    expect(second.status).toBe('running');
    expect(allowed.asks).toEqual([]);
    expect(await executeSubagentWithDeps(call({ isolation: 'worktree', description: 'Third' }), allowed.deps)).toMatchObject({ code: 'concurrency_limit' });
    // A second launch with the same description gets the next branch name.
    expect(allowed.created.map((entry) => entry.branch)).toEqual(['add-rate-limiting', 'second']);

    const noGit = harness({ preconfigs: [{ ...DEV, launches: 'allow' }, EXPLORE], currentBranch: null });
    expect(await executeSubagentWithDeps(call({ isolation: 'worktree' }), noGit.deps)).toMatchObject({ code: 'invalid_request' });
    const noHost = harness({ noWorktrees: true });
    expect(await executeSubagentWithDeps(call({ isolation: 'worktree', ask: noHost.ask }), noHost.deps)).toMatchObject({ code: 'invalid_request' });
    expect(await executeTaskCancel({ task_id: first.task_id, sessionId: 'root' }, allowed.deps)).toMatchObject({ status: 'cancelled' });
  });

  test('a launch needs a role too, and another role launches with its own defaults', async () => {
    const h = harness({ preconfigs: [{ ...DEV, launches: 'allow' }, EXPLORE] });
    expect(await executeSubagentWithDeps(call({ isolation: 'worktree', subagent_type: undefined }), h.deps)).toMatchObject({ code: 'invalid_request' });
    expect(h.created).toEqual([]);

    const result = await executeSubagentWithDeps(call({ isolation: 'worktree', subagent_type: 'explore' }), h.deps);
    expect(result.status).toBe('running');
    expect(h.sessions.get(result.task_id)).toMatchObject({ parentId: null, preconfigId: 'explore' });

    // The caller's own role needs allowSelfAsSubagent for a launch as for a subagent.
    const noSelf = harness({ preconfigs: [{ ...DEV, launches: 'allow', allowSelfAsSubagent: false }, EXPLORE] });
    expect(await executeSubagentWithDeps(call({ isolation: 'worktree', subagent_type: 'dev' }), noSelf.deps)).toMatchObject({ code: 'subagent_not_allowed' });
    expect(noSelf.created).toEqual([]);
  });
});

describe('asking the user for an override', () => {
  test('an override outside the allowed set asks; yes runs it, "allow for this agent" is remembered, no refuses', async () => {
    const asked = harness({ preconfigs: [{ ...DEV, delegationTargets: ['prokop'] }, EXPLORE], answer: () => ({ approved: true, remember: true }) });
    const result = await executeSubagentWithDeps(call({ subagent_type: 'explore', target: { harness: 'codex-cli' }, mode: 'async', ask: asked.ask }), asked.deps);
    expect(result.status).toBe('running');
    expect(asked.asks[0]!.question).toBe('Run "Add rate limiting" on Codex CLI with its default model?');
    expect(asked.asks[0]!.description).toContain('Role: explore');
    expect(asked.remembered).toEqual([['dev', 'codex-cli']]);
    expect(asked.sessions.get(result.task_id)).toMatchObject({ harness: 'codex-cli', parentId: 'root', preconfigId: 'explore' });

    const refused = harness({ preconfigs: [{ ...DEV, delegationTargets: 'ask' }, EXPLORE], answer: () => ({ approved: false }) });
    expect(await executeSubagentWithDeps(call({ subagent_type: 'explore', target: { harness: 'codex-cli' }, ask: refused.ask }), refused.deps)).toMatchObject({ code: 'target_not_allowed' });
    expect(refused.sessions.size).toBe(1);

    const nobody = harness({ preconfigs: [{ ...DEV, delegationTargets: 'ask' }, EXPLORE] });
    expect(await executeSubagentWithDeps(call({ subagent_type: 'explore', target: { harness: 'codex-cli' } }), nobody.deps)).toMatchObject({ code: 'target_not_allowed' });

    // An allowed override never asks; a role run as configured never asks either, even under "ask".
    const silent = harness({ preconfigs: [{ ...DEV, delegationTargets: ['codex-cli'] }, EXPLORE] });
    expect((await executeSubagentWithDeps(call({ subagent_type: 'explore', target: { harness: 'codex-cli' }, mode: 'async', ask: silent.ask }), silent.deps)).status).toBe('running');
    expect(silent.asks).toEqual([]);
    const configured = harness({ preconfigs: [{ ...DEV, delegationTargets: 'ask' }, { ...EXPLORE, modelHarness: 'codex-cli' }] });
    expect((await executeSubagentWithDeps(call({ subagent_type: 'explore', mode: 'async', ask: configured.ask }), configured.deps)).status).toBe('running');
    expect(configured.asks).toEqual([]);
  });

  test('an ask answer reads as a decision', () => {
    expect(delegationDecision(false)).toEqual({ approved: false, remember: false });
    expect(delegationDecision(true)).toEqual({ approved: true, remember: false });
    expect(delegationDecision({ type: 'permission', grant: 'once' })).toEqual({ approved: true, remember: false });
    expect(delegationDecision({ type: 'permission', grant: 'workspace' })).toEqual({ approved: true, remember: true });
    expect(delegationDecision({ approved: false })).toEqual({ approved: false, remember: false });
    expect(delegationDecision({ decision: 'decline' })).toEqual({ approved: false, remember: false });
  });
});
