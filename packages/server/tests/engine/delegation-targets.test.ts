/**
 * Delegation targets and policy: a role's pin always wins, an unpinned role
 * or no role takes an explicit target within the parent's allowed targets,
 * the host validates harness and model, the root's running children are
 * capped, and every refusal carries a typed code.
 */

import { describe, expect, test } from 'bun:test';
import type { HeadlessSessionRunInput } from '@prokopai/core/application/ports/headless-execution';
import type { CodexModel, MessageWithParts, Preconfig, Session, TextPart } from '@prokopai/sdk/types';
import {
  buildDelegationCapabilities,
  freeTargetAllowed,
  resolveDelegationTarget,
  rolePin,
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
  test('a pinned role ignores an agreeing target and refuses a conflicting one', () => {
    expect(rolePin(REVIEWER)).toEqual({ harness: 'codex-cli', model: 'gpt-5.5', provider: null, variant: 'high' });
    expect(rolePin(PROKOP_PIN).harness).toBe('prokop');

    const agreeing = resolveDelegationTarget({ role: REVIEWER, target: { harness: 'codex-cli' }, inherited, parentPreconfig: base });
    expect(agreeing).toEqual({ ok: true, source: 'pin', target: { harness: 'codex-cli', modelId: 'gpt-5.5', providerId: null, variant: 'high' } });

    const conflict = resolveDelegationTarget({ role: REVIEWER, target: { harness: 'claude-cli', model: 'opus' }, inherited, parentPreconfig: base });
    expect(conflict).toMatchObject({ ok: false, code: 'target_conflicts_with_role' });
    if (!conflict.ok) expect(conflict.error).toContain('harness codex-cli, model gpt-5.5');
  });

  test('an unpinned role inherits the parent, or takes the target it is given', () => {
    expect(resolveDelegationTarget({ role: EXPLORE, inherited, parentPreconfig: base })).toEqual({
      ok: true, source: 'inherited', target: { harness: 'prokop', modelId: 'parent-model', providerId: 'parent-provider', variant: null },
    });
    expect(resolveDelegationTarget({ role: EXPLORE, target: { harness: 'claude-cli', model: 'opus', variant: 'max' }, inherited, parentPreconfig: base })).toEqual({
      ok: true, source: 'target', target: { harness: 'claude-cli', modelId: 'opus', providerId: null, variant: 'max' },
    });
    // A target on the parent's own harness without a model keeps the parent's model.
    expect(resolveDelegationTarget({ role: EXPLORE, target: { harness: 'prokop', variant: 'high' }, inherited, parentPreconfig: base })).toMatchObject({
      ok: true, target: { harness: 'prokop', modelId: 'parent-model', providerId: 'parent-provider', variant: 'high' },
    });
  });

  test('no role needs a target, within the parent\'s allowed targets', () => {
    expect(resolveDelegationTarget({ role: null, inherited, parentPreconfig: base })).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(resolveDelegationTarget({ role: null, target: { harness: 'codex-cli' }, inherited, parentPreconfig: base })).toEqual({
      ok: true, source: 'target', target: { harness: 'codex-cli', modelId: null, providerId: null, variant: null },
    });
    expect(resolveDelegationTarget({ role: null, target: { harness: 'codex-cli' }, inherited, parentPreconfig: { ...base, delegationTargets: 'none' } }))
      .toMatchObject({ ok: false, code: 'target_not_allowed' });
    expect(resolveDelegationTarget({ role: null, target: { harness: 'codex-cli' }, inherited, parentPreconfig: { ...base, delegationTargets: ['prokop'] } }))
      .toMatchObject({ ok: false, code: 'target_not_allowed' });
    expect(freeTargetAllowed(['prokop', 'claude-cli'], 'claude-cli')).toBe(true);
    expect(freeTargetAllowed(undefined, 'codex-cli')).toBe(true);
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

  test('capabilities list roles with pins, harness state, short model lists and the caller', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `m-${index}`, name: `Model ${index}`, providerId: 'p' }));
    const capabilities = await buildDelegationCapabilities({
      roles: [REVIEWER, EXPLORE, PROKOP_PIN],
      caller: { harness: 'prokop', model: 'm-11', provider: 'p' },
      parentPreconfig: { ...base, delegationTargets: ['prokop', 'codex-cli'] },
      host: { harnessEnabled: (harness) => harness !== 'claude-cli', harnessAvailable: () => true },
      catalog: { prokopModels: () => [...many, { id: 'minimax-m3', name: 'MiniMax', providerId: 'minimax' }], harnessModels: async () => CLI_MODELS },
      limits: { depth: 2, maxChildren: 4 },
    });

    expect(capabilities.roles).toEqual([
      { id: 'reviewer', name: 'Reviewer', description: 'Reviews on Codex', pinned: { harness: 'codex-cli', model: 'gpt-5.5' } },
      { id: 'explore', name: 'Explore', description: 'Explores', pinned: null },
      { id: 'writer', name: 'Writer', description: 'Builds things', pinned: { harness: 'prokop', model: 'minimax-m3' } },
    ]);
    const prokop = capabilities.harnesses.find((harness) => harness.id === 'prokop')!;
    // The caller's model and the pinned model come first, then the catalog order, capped.
    expect(prokop.models.slice(0, 2).map((model) => model.id)).toEqual(['m-11', 'minimax-m3']);
    expect(prokop.models).toHaveLength(8);
    expect(prokop.omittedModels).toBe(5);
    expect(prokop.current).toBe(true);
    expect(capabilities.harnesses.find((harness) => harness.id === 'claude-cli')).toMatchObject({ enabled: false, available: false, models: [] });
    expect(capabilities.harnesses.find((harness) => harness.id === 'codex-cli')!.models).toEqual([{ id: 'gpt-5.5', name: 'GPT-5.5', efforts: ['low', 'medium', 'high'] }]);
    expect(capabilities.freeTargets).toEqual(['prokop', 'codex-cli']);

    const searched = await buildDelegationCapabilities({
      roles: [], caller: { harness: 'prokop', model: null, provider: null }, parentPreconfig: null, host, catalog: { prokopModels: () => many, harnessModels: async () => [] },
      limits: { depth: 2, maxChildren: 4 }, search: 'model 1',
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
  const children: Array<Parameters<SubagentServiceDeps['executeChild']>[0]> = [];
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
    executeChild: async (input) => {
      children.push(input);
      return { parts: [{ id: 'p', messageId: 'm', createdAt: 0, type: 'text', text: 'in-process' } as TextPart] };
    },
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
  return { deps, sessions, runs, children };
}

const ask = (overrides: Record<string, unknown>) => ({
  description: 'Task', prompt: 'Do it', sessionId: 'root', workspaceId: 'ws-1', ...overrides,
}) as Parameters<typeof executeSubagentWithDeps>[0];

describe('the task tool with targets', () => {
  test('an unpinned role on a target harness runs there with the target model; the child keeps the parent\'s permission mode', async () => {
    const { deps, sessions, runs, children } = makeDeps();

    const result = await executeSubagentWithDeps(ask({ subagent_type: 'explore', target: { harness: 'codex-cli', model: 'gpt-5.5', variant: 'low' } }), deps);

    expect(result.error).toBeUndefined();
    expect(children).toEqual([]);
    expect(runs[0]).toMatchObject({ harness: 'codex-cli', modelId: 'gpt-5.5', preconfig: { id: 'explore', model: 'gpt-5.5', variant: 'low', modelHarness: 'codex-cli' } });
    expect(sessions.get(result.task_id)).toMatchObject({ harness: 'codex-cli', selectedModel: 'gpt-5.5', selectedVariant: 'low', permissionMode: 'extended' });
    expect(result.result).toContain('cli answer');
  });

  test('a pinned role refuses a conflicting target with a typed code and creates nothing', async () => {
    const { deps, sessions } = makeDeps();

    const result = await executeSubagentWithDeps(ask({ subagent_type: 'reviewer', target: { harness: 'claude-cli' } }), deps);

    expect(result).toMatchObject({ task_id: '', code: 'target_conflicts_with_role' });
    expect(sessions.size).toBe(1);
  });

  test('no role copies the parent\'s own role onto the target, within delegationTargets', async () => {
    const { deps, sessions, runs } = makeDeps();

    const result = await executeSubagentWithDeps(ask({ target: { harness: 'codex-cli' } }), deps);
    expect(result.error).toBeUndefined();
    expect(sessions.get(result.task_id)).toMatchObject({ preconfigId: 'dev', agentName: 'dev', harness: 'codex-cli', title: 'Task (@dev subagent)' });
    expect(runs[0]?.preconfig.id).toBe('dev');

    const limited = makeDeps({ preconfigs: [{ ...base, delegationTargets: 'none' }, EXPLORE] });
    expect(await executeSubagentWithDeps(ask({ target: { harness: 'codex-cli' } }), limited.deps)).toMatchObject({ code: 'target_not_allowed' });
    expect(await executeSubagentWithDeps(ask({}), limited.deps)).toMatchObject({ code: 'invalid_request' });
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

  test('a Prokop-pinned role still runs in-process with its pin and the plain call stays as before', async () => {
    const { deps, children, sessions } = makeDeps();

    const pinned = await executeSubagentWithDeps(ask({ subagent_type: 'writer' }), deps);
    expect(children[0]).toMatchObject({ modelId: 'minimax-m3', providerId: 'minimax' });
    expect(sessions.get(pinned.task_id)).toMatchObject({ selectedModel: 'minimax-m3', selectedProvider: 'minimax', selectedVariant: null });

    const plain = await executeSubagentWithDeps(ask({ subagent_type: 'explore' }), deps);
    expect(children[1]).toMatchObject({ modelId: 'parent-model', providerId: 'parent-provider' });
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
