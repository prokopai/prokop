/**
 * Delegation targets and policy: every delegation names a role, the role's
 * harness and model are its defaults, a target overrides them within the
 * parent's delegation targets, the host validates harness and model, the
 * root's running children are capped, and every refusal carries a typed code.
 */

import { describe, expect, test } from 'bun:test';
import type { HeadlessSessionRunInput } from '@prokopai/core/application/ports/headless-execution';
import type { CodexModel, MessageWithParts, Preconfig, Session, TextPart } from '@prokopai/sdk/types';
import {
  buildDelegationCapabilities,
  launchBranchName,
  overridePolicy,
  resolveDelegationTarget,
  roleDefaults,
  validateDelegationTarget,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/delegation';
import {
  countRunningDescendants,
  executeSubagentWithDeps,
  type SubagentServiceDeps,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/task-tool';

const base: Preconfig = {
  id: 'dev', name: 'Dev', description: 'Builds things', systemPrompt: '', tools: null,
  model: null, provider: null, variant: null, settings: null, isDefault: false, mode: 'both',
  canSpawnSubagents: true, allowSelfAsSubagent: false,
};
const REVIEWER: Preconfig = { ...base, id: 'reviewer', name: 'Reviewer', description: 'Reviews on Codex', mode: 'subagent', model: 'gpt-5.5', variant: 'high', modelHarness: 'codex-cli' };
const EXPLORE: Preconfig = { ...base, id: 'explore', name: 'Explore', description: 'Explores', mode: 'subagent' };
const PROKOP_PIN: Preconfig = { ...base, id: 'writer', name: 'Writer', mode: 'subagent', model: 'minimax-m3', provider: 'minimax' };

const inherited = { harness: 'prokop' as const, modelId: 'parent-model', providerId: 'parent-provider', variant: 'low' };
const CLI_MODELS: CodexModel[] = [
  { model: 'gpt-5.5', name: 'GPT-5.5', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
];
const host = { harnessEnabled: () => true, harnessAvailable: () => true };
const catalog = {
  prokopModels: () => [{ id: 'parent-model', name: 'Parent', providerId: 'parent-provider' }, { id: 'minimax-m3', name: 'MiniMax', providerId: 'minimax' }],
  harnessModels: async () => CLI_MODELS,
};

describe('resolving where a delegated child runs', () => {
  test('a role runs on its own harness and model; a target that restates them is no override', () => {
    expect(roleDefaults(REVIEWER)).toEqual({ harness: 'codex-cli', model: 'gpt-5.5', provider: null, variant: 'high' });
    expect(roleDefaults(PROKOP_PIN).harness).toBe('prokop');

    const asConfigured = { harness: 'codex-cli' as const, modelId: 'gpt-5.5', providerId: null, variant: 'high' };
    expect(resolveDelegationTarget({ role: REVIEWER, inherited, parentPreconfig: base }))
      .toEqual({ ok: true, source: 'role', needsApproval: false, target: asConfigured });
    expect(resolveDelegationTarget({ role: REVIEWER, target: { harness: 'codex-cli', model: 'gpt-5.5' }, inherited, parentPreconfig: { ...base, delegationTargets: 'none' } }))
      .toEqual({ ok: true, source: 'role', needsApproval: false, target: asConfigured });
  });

  test('a target overrides the role: another harness drops the role\'s model, another model drops its variant', () => {
    expect(resolveDelegationTarget({ role: REVIEWER, target: { harness: 'claude-cli', model: 'opus' }, inherited, parentPreconfig: base })).toEqual({
      ok: true, source: 'target', needsApproval: false, target: { harness: 'claude-cli', modelId: 'opus', providerId: null, variant: null },
    });
    // Moved onto the parent's harness without a model: the parent's model, not the role's Codex one.
    expect(resolveDelegationTarget({ role: REVIEWER, target: { harness: 'prokop' }, inherited, parentPreconfig: base })).toMatchObject({
      source: 'target', target: { harness: 'prokop', modelId: 'parent-model', providerId: 'parent-provider', variant: null },
    });
    expect(resolveDelegationTarget({ role: REVIEWER, target: { model: 'gpt-5.5-mini' }, inherited, parentPreconfig: base })).toMatchObject({
      source: 'target', target: { harness: 'codex-cli', modelId: 'gpt-5.5-mini', variant: null },
    });
    expect(resolveDelegationTarget({ role: REVIEWER, target: { variant: 'low' }, inherited, parentPreconfig: base })).toMatchObject({
      source: 'target', target: { harness: 'codex-cli', modelId: 'gpt-5.5', variant: 'low' },
    });
  });

  test('a role with no defaults runs where the parent runs, or where the target says', () => {
    expect(resolveDelegationTarget({ role: EXPLORE, inherited, parentPreconfig: base })).toEqual({
      ok: true, source: 'role', needsApproval: false, target: { harness: 'prokop', modelId: 'parent-model', providerId: 'parent-provider', variant: null },
    });
    expect(resolveDelegationTarget({ role: EXPLORE, target: { harness: 'claude-cli', model: 'opus', variant: 'max' }, inherited, parentPreconfig: base })).toEqual({
      ok: true, source: 'target', needsApproval: false, target: { harness: 'claude-cli', modelId: 'opus', providerId: null, variant: 'max' },
    });
    // A target on the parent's own harness without a model keeps the parent's model.
    expect(resolveDelegationTarget({ role: EXPLORE, target: { harness: 'prokop', variant: 'high' }, inherited, parentPreconfig: base })).toMatchObject({
      ok: true, source: 'target', target: { harness: 'prokop', modelId: 'parent-model', providerId: 'parent-provider', variant: 'high' },
    });
  });

  test('overrides follow the parent\'s delegation targets: allow, ask, or refuse', () => {
    const override = { harness: 'codex-cli' as const };
    expect(resolveDelegationTarget({ role: EXPLORE, target: override, inherited, parentPreconfig: { ...base, delegationTargets: 'none' } }))
      .toMatchObject({ ok: false, code: 'target_not_allowed' });
    // Outside the list, or with "ask": the user decides.
    expect(resolveDelegationTarget({ role: EXPLORE, target: override, inherited, parentPreconfig: { ...base, delegationTargets: ['prokop'] } }))
      .toMatchObject({ ok: true, needsApproval: true });
    expect(resolveDelegationTarget({ role: EXPLORE, target: { harness: 'prokop', variant: 'high' }, inherited, parentPreconfig: { ...base, delegationTargets: ['prokop'] } }))
      .toMatchObject({ ok: true, needsApproval: false });
    expect(resolveDelegationTarget({ role: EXPLORE, target: override, inherited, parentPreconfig: { ...base, delegationTargets: 'ask' } }))
      .toMatchObject({ ok: true, needsApproval: true });
    // The role as configured never asks, whatever the setting.
    expect(resolveDelegationTarget({ role: REVIEWER, inherited, parentPreconfig: { ...base, delegationTargets: 'ask' } }))
      .toMatchObject({ ok: true, needsApproval: false });
    expect(overridePolicy(['prokop', 'claude-cli'], 'claude-cli')).toBe('allow');
    expect(overridePolicy(['prokop'], 'claude-cli')).toBe('ask');
    expect(overridePolicy(undefined, 'codex-cli')).toBe('allow');
    expect(overridePolicy('ask', 'prokop')).toBe('ask');
    expect(overridePolicy('none', 'prokop')).toBe('deny');
  });

  test('the host validates harness state and the model against the right catalog', async () => {
    const disabled = { harnessEnabled: (harness: string) => harness !== 'codex-cli', harnessAvailable: () => true };
    expect(await validateDelegationTarget({ harness: 'codex-cli', modelId: null, providerId: null, variant: null }, disabled, catalog))
      .toMatchObject({ ok: false, code: 'harness_unavailable' });
    const missing = { harnessEnabled: () => true, harnessAvailable: (harness: string) => harness === 'prokop' };
    expect(await validateDelegationTarget({ harness: 'claude-cli', modelId: null, providerId: null, variant: null }, missing, catalog))
      .toMatchObject({ ok: false, code: 'harness_unavailable' });

    expect(await validateDelegationTarget({ harness: 'prokop', modelId: 'nope', providerId: null, variant: null }, host, catalog))
      .toMatchObject({ ok: false, code: 'model_unavailable' });
    expect(await validateDelegationTarget({ harness: 'prokop', modelId: 'minimax-m3', providerId: 'minimax', variant: null }, host, catalog)).toEqual({ ok: true });
    expect(await validateDelegationTarget({ harness: 'codex-cli', modelId: 'gpt-5.5', providerId: null, variant: 'xhigh' }, host, catalog))
      .toMatchObject({ ok: false, code: 'model_unavailable' });
    expect(await validateDelegationTarget({ harness: 'codex-cli', modelId: 'gpt-5.5', providerId: null, variant: 'high' }, host, catalog)).toEqual({ ok: true });
    expect(await validateDelegationTarget({ harness: 'claude-cli', modelId: 'opus', providerId: null, variant: null }, host, {
      ...catalog, harnessModels: async () => { throw new Error('no cli'); },
    })).toMatchObject({ ok: false, code: 'harness_unavailable' });
  });

  test('capabilities list roles with defaults, harness state, short model lists and the caller', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `m-${index}`, name: `Model ${index}`, providerId: 'p' }));
    const capabilities = await buildDelegationCapabilities({
      roles: [REVIEWER, EXPLORE, PROKOP_PIN],
      caller: { harness: 'prokop', model: 'm-11', provider: 'p' },
      parentPreconfig: { ...base, delegationTargets: ['prokop', 'codex-cli'] },
      host: { harnessEnabled: (harness) => harness !== 'claude-cli', harnessAvailable: () => true },
      catalog: { prokopModels: () => [...many, { id: 'minimax-m3', name: 'MiniMax', providerId: 'minimax' }], harnessModels: async () => CLI_MODELS },
      limits: { depth: 2, maxChildren: 4, maxLaunches: 3 },
    });

    expect(capabilities.launches).toBe('ask');
    expect(capabilities.limits.maxLaunches).toBe(3);
    expect(launchBranchName('Add rate limiting to the API!')).toBe('add-rate-limiting-to-the-api');
    expect(launchBranchName('???')).toBe('task');
    expect(capabilities.roles).toEqual([
      { id: 'reviewer', name: 'Reviewer', description: 'Reviews on Codex', defaults: { harness: 'codex-cli', model: 'gpt-5.5' } },
      { id: 'explore', name: 'Explore', description: 'Explores', defaults: null },
      { id: 'writer', name: 'Writer', description: 'Builds things', defaults: { harness: 'prokop', model: 'minimax-m3' } },
    ]);
    const prokop = capabilities.harnesses.find((harness) => harness.id === 'prokop')!;
    // The caller's model and the roles' models come first, then the catalog order, capped.
    expect(prokop.models.slice(0, 2).map((model) => model.id)).toEqual(['m-11', 'minimax-m3']);
    expect(prokop.models).toHaveLength(8);
    expect(prokop.omittedModels).toBe(5);
    expect(prokop.current).toBe(true);
    expect(capabilities.harnesses.find((harness) => harness.id === 'claude-cli')).toMatchObject({ enabled: false, available: false, models: [] });
    expect(capabilities.harnesses.find((harness) => harness.id === 'codex-cli')!.models).toEqual([{ id: 'gpt-5.5', name: 'GPT-5.5', efforts: ['low', 'medium', 'high'] }]);
    expect(capabilities.overrides).toEqual(['prokop', 'codex-cli']);
    expect(capabilities.note).toContain('subagent_type');

    const searched = await buildDelegationCapabilities({
      roles: [], caller: { harness: 'prokop', model: null, provider: null }, parentPreconfig: null, host, catalog: { prokopModels: () => many, harnessModels: async () => [] },
      limits: { depth: 2, maxChildren: 4, maxLaunches: 3 }, search: 'model 1',
    });
    expect(searched.harnesses.find((harness) => harness.id === 'prokop')!.models.map((model) => model.id)).toEqual(['m-1', 'm-10', 'm-11']);
  });
});

function session(overrides: Partial<Session>): Session {
  return {
    id: 'root', workspaceId: 'ws-1', preconfigId: 'dev', title: 'Root', status: 'active', metadata: null,
    createdAt: '', updatedAt: '', parentId: null, agentName: null, harness: 'prokop', selectedModel: 'parent-model',
    selectedProvider: 'parent-provider', permissionMode: 'extended', ...overrides,
  } as Session;
}

function makeDeps(options: { preconfigs?: Preconfig[]; maxChildren?: number; enabled?: (harness: string) => boolean } = {}) {
  const preconfigs = options.preconfigs ?? [base, REVIEWER, EXPLORE, PROKOP_PIN];
  const sessions = new Map<string, Session>([['root', session({ id: 'root' })]]);
  const runs: HeadlessSessionRunInput[] = [];
  const transcripts = new Map<string, MessageWithParts[]>();
  const deps: SubagentServiceDeps = {
    sessionAccess: {
      getSession: (id) => sessions.get(id) ?? null,
      createSession: (input) => {
        const created = { ...input, createdAt: '', updatedAt: '' } as Session;
        sessions.set(created.id, created);
        return created;
      },
      updateSession: (id, updates) => {
        const existing = sessions.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates } as Session;
        sessions.set(id, updated);
        return updated;
      },
      getWorkspaceAutoApproveSeverity: async () => 'low',
      listChildSessions: (parentId) => [...sessions.values()].filter((candidate) => candidate.parentId === parentId),
    },
    preconfigs: {
      getPreconfigOrAgent: async (id) => preconfigs.find((preconfig) => preconfig.id === id) ?? null,
      listSubagentPreconfigs: async () => preconfigs.filter((preconfig) => preconfig.mode !== 'primary'),
    },
    broadcasts: { event: () => {}, sessionCreated: () => {}, sessionUpdated: () => {}, toSession: () => {} },
    runOnHarness: async (input) => {
      runs.push(input);
      transcripts.set(input.childSessionId, [{
        message: { id: 'a', sessionId: input.childSessionId, role: 'assistant', createdAt: 1 } as MessageWithParts['message'],
        parts: [{ id: 'pa', messageId: 'a', createdAt: 1, type: 'text', text: 'cli answer' } as TextPart],
      }]);
      return {};
    },
    readTranscript: async (id) => transcripts.get(id) ?? [],
    host: { harnessEnabled: options.enabled ?? (() => true), harnessAvailable: () => true },
    catalog,
    maxChildren: () => options.maxChildren ?? 4,
  };
  return { deps, sessions, runs };
}

const ask = (overrides: Record<string, unknown>) => ({
  description: 'Task', prompt: 'Do it', sessionId: 'root', workspaceId: 'ws-1', ...overrides,
}) as Parameters<typeof executeSubagentWithDeps>[0];

describe('the task tool with targets', () => {
  test('a role with no defaults on a target harness runs there with the target model; the child keeps the parent\'s permission mode', async () => {
    const { deps, sessions, runs } = makeDeps();

    const result = await executeSubagentWithDeps(ask({ subagent_type: 'explore', target: { harness: 'codex-cli', model: 'gpt-5.5', variant: 'low' } }), deps);

    expect(result.error).toBeUndefined();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ harness: 'codex-cli', modelId: 'gpt-5.5', preconfig: { id: 'explore', model: 'gpt-5.5', variant: 'low', modelHarness: 'codex-cli' } });
    expect(sessions.get(result.task_id)).toMatchObject({ harness: 'codex-cli', selectedModel: 'gpt-5.5', selectedVariant: 'low', permissionMode: 'extended' });
    expect(result.result).toContain('cli answer');
  });

  test('a role with its own harness and model takes an override, and runs there with the override\'s model', async () => {
    const { deps, sessions, runs } = makeDeps();

    const result = await executeSubagentWithDeps(ask({ subagent_type: 'reviewer', target: { harness: 'claude-cli' } }), deps);

    expect(result.error).toBeUndefined();
    expect(runs[0]).toMatchObject({ harness: 'claude-cli', modelId: '', preconfig: { id: 'reviewer', model: null, variant: null, modelHarness: 'claude-cli' } });
    expect(sessions.get(result.task_id)).toMatchObject({ harness: 'claude-cli', selectedModel: null, selectedVariant: null });
  });

  test('a call without a role is refused, with or without a target, and "roles only" refuses every override', async () => {
    const { deps, sessions } = makeDeps();

    expect(await executeSubagentWithDeps(ask({ target: { harness: 'codex-cli' } }), deps)).toMatchObject({ task_id: '', code: 'invalid_request' });
    expect(await executeSubagentWithDeps(ask({}), deps)).toMatchObject({ task_id: '', code: 'invalid_request' });
    expect(sessions.size).toBe(1);

    const limited = makeDeps({ preconfigs: [{ ...base, delegationTargets: 'none' }, REVIEWER, EXPLORE] });
    expect(await executeSubagentWithDeps(ask({ subagent_type: 'explore', target: { harness: 'codex-cli' } }), limited.deps)).toMatchObject({ code: 'target_not_allowed' });
    expect(await executeSubagentWithDeps(ask({ subagent_type: 'reviewer', target: { model: 'gpt-5.5-mini' } }), limited.deps)).toMatchObject({ code: 'target_not_allowed' });
    expect(limited.sessions.size).toBe(1);
    // The role as configured still runs.
    expect((await executeSubagentWithDeps(ask({ subagent_type: 'reviewer' }), limited.deps)).error).toBeUndefined();
  });

  test('a disabled harness and an unknown model are refused before a session exists', async () => {
    const disabled = makeDeps({ enabled: (harness) => harness !== 'codex-cli' });
    expect(await executeSubagentWithDeps(ask({ subagent_type: 'explore', target: { harness: 'codex-cli' } }), disabled.deps))
      .toMatchObject({ code: 'harness_unavailable' });
    expect(disabled.sessions.size).toBe(1);

    const { deps, sessions } = makeDeps();
    expect(await executeSubagentWithDeps(ask({ subagent_type: 'explore', target: { model: 'ghost' } }), deps))
      .toMatchObject({ code: 'model_unavailable' });
    expect(sessions.size).toBe(1);
  });

  test('a role with a Prokop model runs on Prokop with it, and the plain call inherits the parent\'s model', async () => {
    const { deps, runs, sessions } = makeDeps();

    const pinned = await executeSubagentWithDeps(ask({ subagent_type: 'writer' }), deps);
    expect(runs[0]).toMatchObject({ harness: 'prokop', modelId: 'minimax-m3', providerId: 'minimax' });
    expect(sessions.get(pinned.task_id)).toMatchObject({ selectedModel: 'minimax-m3', selectedProvider: 'minimax', selectedVariant: null });

    const plain = await executeSubagentWithDeps(ask({ subagent_type: 'explore' }), deps);
    expect(runs[1]).toMatchObject({ harness: 'prokop', modelId: 'parent-model', providerId: 'parent-provider' });
    expect(sessions.get(plain.task_id)).toMatchObject({ selectedModel: 'parent-model', selectedVariant: null });
    expect(sessions.get(plain.task_id)?.harness).toBeUndefined();
    expect(plain.code).toBeUndefined();
  });

  test('the fifth running child under one root is refused with concurrency_limit', async () => {
    const { deps, sessions } = makeDeps({ maxChildren: 2 });
    sessions.set('c1', session({ id: 'c1', parentId: 'root', preconfigId: 'explore', subagentStatus: 'running' }));
    sessions.set('c2', session({ id: 'c2', parentId: 'c1', preconfigId: 'explore', subagentStatus: 'running' }));
    sessions.set('c3', session({ id: 'c3', parentId: 'root', preconfigId: 'explore', subagentStatus: 'completed' }));
    expect(await countRunningDescendants('root', deps.sessionAccess.listChildSessions!)).toBe(2);

    const result = await executeSubagentWithDeps(ask({ subagent_type: 'explore' }), deps);
    expect(result).toMatchObject({ code: 'concurrency_limit' });
    expect(result.error).toContain('limit 2');

    sessions.set('c2', session({ id: 'c2', parentId: 'c1', preconfigId: 'explore', subagentStatus: 'completed' }));
    expect((await executeSubagentWithDeps(ask({ subagent_type: 'explore' }), deps)).code).toBeUndefined();
  });

  test('depth, allow-list and resume refusals carry codes', async () => {
    const { deps, sessions } = makeDeps();
    sessions.set('leaf', session({ id: 'leaf', parentId: 'mid', preconfigId: 'explore' }));
    sessions.set('mid', session({ id: 'mid', parentId: 'root', preconfigId: 'explore' }));
    expect(await executeSubagentWithDeps(ask({ sessionId: 'leaf', subagent_type: 'explore' }), deps)).toMatchObject({ code: 'depth_exceeded' });
    expect(await executeSubagentWithDeps(ask({ subagent_type: 'explore', allowedSubagentIds: ['reviewer'] }), deps)).toMatchObject({ code: 'subagent_not_allowed' });
    expect(await executeSubagentWithDeps(ask({ subagent_type: 'ghost' }), deps)).toMatchObject({ code: 'invalid_request' });
    sessions.set('foreign', session({ id: 'foreign', parentId: 'elsewhere', preconfigId: 'explore' }));
    expect(await executeSubagentWithDeps(ask({ subagent_type: 'explore', task_id: 'foreign' }), deps)).toMatchObject({ code: 'task_not_found' });
  });
});
