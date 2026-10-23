/**
 * C5 subagent domain slice characterization.
 *
 * Pins the domain plugin ownership: the policy service (depth gate over the
 * scope-captured storage) and the self-delegation context section, with no
 * tool contribution (delegation is a runtime tool on the workspace tool
 * list), the ancestry policy matrix, and the WithDeps execution lifecycle
 * (child creation, resume validation, status transitions, ordered result
 * formatting, structured output, abort handling) against injected fakes.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MessageWithParts, Preconfig, Session, TextPart } from '@prokopai/sdk/types';
import type { HeadlessSessionRunInput } from '@prokopai/core/application/ports/headless-execution';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
} from '@prokopai/agent/internal/harnesses/prokop/context/sources';
import { configureRuntimeConfiguration } from '@prokopai/core/infrastructure/providers/configuration/runtime';
import { createCurrentAgentScope, createCurrentProcessScope } from '#tests/engine/helpers/composition';
import { resetDomainToolFallbacksForTests } from '@prokopai/core/infrastructure/tools/domain-tool-source';
import { configureRuntimeHost, type RuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import {
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
  SELF_DELEGATION_SECTION_ID,
  capekSubagentDomainKey,
} from '@prokopai/agent/internal/harnesses/prokop/composition/plugins/subagent-domain';
import {
  evaluateSubagentTarget,
  getSubagentResumeError,
  isSubagentSpawningDisabled,
  isValidSubagentTargetPreconfig,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/policy';
import {
  executeSubagentWithDeps,
  type SubagentServiceDeps,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/task-tool';
import { selfDelegationGuidance } from '@prokopai/agent/internal/harnesses/prokop/subagent/guidance';
import { configureStorage, createSession } from '@prokopai/core/infrastructure/storage/runtime';
import { createInMemoryStorageBundle } from '@prokopai/core/infrastructure/storage/memory';
import { configureWorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';

function minimalHost(): RuntimeHost {
  return {
    interaction: {
      createPendingAsk: async () => 'pending',
      removePendingAsk: async () => {},
      removePendingAsksByToolCallId: async () => {},
      getPermissionRequestByRequestId: async () => null,
      resolvePermissionRequestByRequestId: async () => false,
      expirePermissionRequest: async () => false,
      expireOldPermissionRequests: async () => 0,
      cancelPendingRequestsBySession: async () => 0,
      listPendingAsksBySession: async () => [],
      listPendingAsksByRootSession: async () => [],
      listPendingRequestsByRootSession: async () => [],
      matchGrant: async () => ({ matched: false, grant: null }),
      createGrantFromOptions: async () => null,
      getSessionAutoApproveSeverity: async () => undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyAnswerRequired: async () => {},
    },
    delivery: { emit: () => {} },
    titles: {
      isDefaultSessionTitle: () => true,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost: () => ({
        root: '/tmp',
        additionalRoots: undefined,
        allowedRoots: [],
        tempDir: '/tmp/capek-c5-subagent-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

const EXPLORE_PRECONFIG = {
  id: 'explore',
  name: 'Explore',
  description: 'Research tasks',
  mode: 'subagent',
  model: null,
  provider: null,
  systemPrompt: '',
  tools: [],
  settings: null,
  isDefault: false,
} as Preconfig;

const RESEARCH_PRECONFIG = {
  id: 'research',
  name: 'Research',
  description: 'Deep research',
  mode: 'subagent',
  model: null,
  provider: null,
  systemPrompt: '',
  tools: [],
  settings: null,
  isDefault: false,
} as Preconfig;

const SELF_PRECONFIG = {
  id: 'agent-x',
  name: 'Agent X',
  description: 'Self-delegating agent',
  mode: 'both',
  model: null,
  provider: null,
  systemPrompt: '',
  tools: [],
  settings: null,
  isDefault: false,
  allowSelfAsSubagent: true,
} as Preconfig;

function configureEnvironment(): void {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configurePreconfigSource({
    get: async (id) => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG, SELF_PRECONFIG].find((p) => p.id === id) ?? null,
    getDefault: async () => null,
    getForAgent: async (id) => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG, SELF_PRECONFIG].find((p) => p.id === id) ?? null,
    list: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG, SELF_PRECONFIG],
    listSubagents: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
  });
  configureAgentSource();
  configureInstructionSource();
  configureWorkspaceToolDiscovery();
}

afterEach(async () => {
  configureEnvironment();
  resetDomainToolFallbacksForTests();
});

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-root',
    workspaceId: 'ws-1',
    preconfigId: null,
    title: null,
    status: 'active',
    metadata: null,
    parentId: null,
    agentName: null,
    autoApproveSeverity: 'low',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as Session;
}

describe('C5 subagent composed scope ownership', () => {
  beforeEach(() => configureEnvironment());

  test('the composed current agent scope provides the subagent policy and contributes no tool', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      // Delegation reaches a Prokop session as a runtime tool on the workspace tool list.
      expect(agentScope.listTools().filter((entry) => entry.pluginId === CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID)).toEqual([]);
      expect(agentScope.listTools().map((entry) => entry.definition.name)).not.toContain('task');
      const service = agentScope.require(capekSubagentDomainKey);
      expect(await service.canSpawnSubagent('sess-root')).toBe(true);
      expect((await service.resolveTargets({ sessionId: 'sess-root', canSpawnSubagents: true })).map((role) => role.id))
        .toEqual(['explore', 'research']);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed current agent scope owns the self-delegation section with the exact guidance content', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const section = agentScope
        .listContextSections()
        .find((entry) => entry.id === SELF_DELEGATION_SECTION_ID);
      expect(section).toBeDefined();
      expect(section!.pluginId).toBe(CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID);
      expect(section!.phase).toBe('identity');
      expect(section!.order).toBe(50);

      const sections = await agentScope.buildContext({
        preconfig: SELF_PRECONFIG,
        workspacePath: undefined,
        workspaceId: undefined,
        additionalPaths: [],
        selfDelegationAvailable: true,
      });
      const selfDelegation = sections.find((entry) => entry.id === SELF_DELEGATION_SECTION_ID);
      expect(selfDelegation?.content).toBe(selfDelegationGuidance('agent-x'));
      // The shared delegation paragraph only when the tool is in the session's list.
      expect(sections.find((entry) => entry.id === 'delegation')).toBeUndefined();
      const withTool = await agentScope.buildContext({
        preconfig: SELF_PRECONFIG, workspacePath: undefined, workspaceId: undefined, additionalPaths: [],
        delegationAvailable: true, selfDelegationAvailable: true,
      });
      const delegation = withTool.find((entry) => entry.id === 'delegation');
      expect(delegation?.content).toContain('delegate_task hands a task');
      expect(withTool.findIndex((entry) => entry.id === 'delegation')).toBeLessThan(withTool.findIndex((entry) => entry.id === SELF_DELEGATION_SECTION_ID));

      const hidden = await agentScope.buildContext({
        preconfig: SELF_PRECONFIG,
        workspacePath: undefined,
        workspaceId: undefined,
        additionalPaths: [],
        selfDelegationAvailable: false,
      });
      expect(hidden.find((entry) => entry.id === SELF_DELEGATION_SECTION_ID)).toBeUndefined();
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed depth gate reads the scope-captured storage', async () => {
    configureStorage(createInMemoryStorageBundle());
    createSession(makeSession({ id: 'root', preconfigId: 'agent-x' }));
    createSession(makeSession({ id: 'child-1', parentId: 'root', preconfigId: 'explore' }));
    createSession(makeSession({ id: 'child-2', parentId: 'child-1', preconfigId: 'explore' }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      expect(await agentScope.require(capekSubagentDomainKey).canSpawnSubagent('child-2')).toBe(false);
      expect(await agentScope.require(capekSubagentDomainKey).canSpawnSubagent('root')).toBe(true);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('C5 subagent ancestry policy', () => {
  test('target evaluation covers self-disabled, allowed self, repeated ancestor, target-not-allowed, and depth', () => {
    expect(evaluateSubagentTarget({
      targetPreconfigId: 'explore',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: false,
    })).toEqual({ allowed: true, reason: 'allowed' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'agent-x',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: false,
    })).toMatchObject({ allowed: false, reason: 'self_disabled' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'agent-x',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: true,
    })).toEqual({ allowed: true, reason: 'allowed' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'agent-x',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x', 'agent-x'],
      allowSelfAsSubagent: true,
    })).toMatchObject({ allowed: false, reason: 'repeated_ancestor' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'explore',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x', 'explore'],
      allowSelfAsSubagent: false,
    })).toMatchObject({ allowed: false, reason: 'repeated_ancestor' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'explore',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: false,
      allowedSubagentIds: ['research'],
    })).toMatchObject({ allowed: false, reason: 'target_not_allowed' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'explore',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: false,
      maximumDepthReached: true,
    })).toMatchObject({ allowed: false, reason: 'maximum_depth' });
  });

  test('spawn-disabled and target-preconfig classification rules', () => {
    expect(isSubagentSpawningDisabled(false)).toBe(true);
    expect(isSubagentSpawningDisabled(null)).toBe(true);
    expect(isSubagentSpawningDisabled([])).toBe(true);
    expect(isSubagentSpawningDisabled(['explore'])).toBe(false);
    expect(isSubagentSpawningDisabled(true)).toBe(false);
    expect(isSubagentSpawningDisabled(undefined)).toBe(false);

    expect(isValidSubagentTargetPreconfig(EXPLORE_PRECONFIG, 'agent-x', false)).toBe(true);
    expect(isValidSubagentTargetPreconfig({ id: 'agent-x', mode: 'primary' }, 'agent-x', true)).toBe(true);
    expect(isValidSubagentTargetPreconfig({ id: 'agent-x', mode: 'primary' }, 'agent-x', false)).toBe(false);
  });

  test('resume validation rejects forged task ids from other sessions and preconfig types', () => {
    expect(getSubagentResumeError(
      { parentId: 'other', preconfigId: 'explore' },
      'sess-root',
      'explore',
    )).toBe('Invalid task_id: does not belong to this session');

    expect(getSubagentResumeError(
      { parentId: 'sess-root', preconfigId: 'research' },
      'sess-root',
      'explore',
    )).toBe('Invalid task_id: belongs to subagent type "research", not "explore"');

    expect(getSubagentResumeError(
      { parentId: 'sess-root', preconfigId: 'explore' },
      'sess-root',
      'explore',
    )).toBeNull();
  });
});

describe('C5 subagent execution with injected deps', () => {
  function makeState() {
    const state = {
      sessions: new Map<string, Session>(),
      updates: [] as Array<{ id: string; updates: Record<string, unknown> }>,
      events: [] as unknown[],
      children: [] as HeadlessSessionRunInput[],
      transcripts: new Map<string, MessageWithParts[]>(),
    };
    // The child's answer, as the host dispatch leaves it in the child's transcript.
    const answer = (childSessionId: string, text: string): void => {
      state.transcripts.set(childSessionId, [...(state.transcripts.get(childSessionId) ?? []), {
        message: { id: `a-${state.transcripts.size}`, sessionId: childSessionId, role: 'assistant', createdAt: 1 } as MessageWithParts['message'],
        parts: [{ id: 'pa', messageId: 'a', createdAt: 1, type: 'text', text } as TextPart],
      }]);
    };

    const sessionAccess: SubagentServiceDeps['sessionAccess'] = {
      getSession: (id) => state.sessions.get(id) ?? null,
      createSession: (session) => {
        const created = { ...session, createdAt: '', updatedAt: '' } as Session;
        state.sessions.set(created.id, created);
        return created;
      },
      updateSession: (id, updates) => {
        state.updates.push({ id, updates: { ...updates } });
        const existing = state.sessions.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates };
        state.sessions.set(updated.id, updated);
        return updated;
      },
      getWorkspaceAutoApproveSeverity: async () => 'low',
    };

    const deps: SubagentServiceDeps = {
      sessionAccess,
      preconfigs: {
        getPreconfigOrAgent: async (id) =>
          [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG, SELF_PRECONFIG].find((p) => p.id === id) ?? null,
        listSubagentPreconfigs: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
      },
      broadcasts: {
        event: (event) => state.events.push(event),
        sessionCreated: (session) => state.events.push({ created: session.id }),
        sessionUpdated: (session) => state.events.push({ updated: session.id }),
        toSession: (sessionId, event) => state.events.push({ to: sessionId, event }),
      },
      runOnHarness: async (input) => {
        state.children.push(input);
        if (input.childSessionId === 'failing-child') return { error: 'child exploded' };
        // A schema request is answered with JSON, anything else with text.
        answer(input.childSessionId, input.prompt.includes('Reply with only a JSON object') ? '{"verdict":"ok"}' : 'final-answer');
        return {};
      },
      readTranscript: async (id) => state.transcripts.get(id) ?? [],
    };

    return { state, deps, answer };
  }

  function baseInput(overrides: Record<string, unknown> = {}): Parameters<typeof executeSubagentWithDeps>[0] {
    return {
      description: 'Probe the repo',
      prompt: 'Investigate the layout',
      subagent_type: 'explore',
      sessionId: 'sess-root',
      workspaceId: 'ws-1',
      ...overrides,
    } as Parameters<typeof executeSubagentWithDeps>[0];
  }

  test('creates the child session with the exact parent-child fields and ordered result formatting', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({
      id: 'sess-root',
      preconfigId: 'agent-x',
      workspaceRootId: 'managed-root-1',
    }));

    const result = await executeSubagentWithDeps(baseInput(), deps);

    const child = state.sessions.get(result.task_id)!;
    expect(child.parentId).toBe('sess-root');
    expect(child.preconfigId).toBe('explore');
    expect(child.title).toBe('Probe the repo (@explore subagent)');
    expect(child.agentName).toBe('explore');
    expect(child.subagentStatus).toBe('completed');
    // The flag marks a child the host drives, which the harness state turns into Stop on its own session.
    expect(child.metadata).toEqual({ delegatedChild: true });
    expect(child.workspaceId).toBe('ws-1');
    expect(child.workspaceRootId).toBe('managed-root-1');
    expect(child.autoApproveSeverity).toBe('low');
    expect(state.children[0]).toMatchObject({
      parentSessionId: 'sess-root',
      childSessionId: result.task_id,
      prompt: 'Investigate the layout',
      resumeFromHistory: false,
    });
    expect(result.result).toBe(
      `task_id: ${result.task_id} (for resuming to continue this task if needed)\n\n<task_result>\nfinal-answer\n</task_result>\n`,
    );
    expect(result.error).toBeUndefined();
    expect(state.events.some((event) => (event as { created?: string }).created === result.task_id)).toBe(true);
    expect(state.events.some((event) => (event as { updated?: string }).updated === result.task_id)).toBe(true);
  });

  test('marks the child errored on execution error and returns the error directly without text', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const result = await executeSubagentWithDeps(baseInput({ subagent_type: 'explore' }), {
      ...deps,
      runOnHarness: async () => ({ error: 'child exploded' }),
    });

    expect(result.result).toBe('');
    expect(result.error).toBe('child exploded');
    const child = state.sessions.get(result.task_id)!;
    expect(child.subagentStatus).toBe('error');
  });

  test('captures structured output when an output schema is provided', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const result = await executeSubagentWithDeps(
      baseInput({ outputSchema: { type: 'object' } }),
      deps,
    );

    expect(result.structuredResult).toEqual({ verdict: 'ok' });
    expect(result.result).toContain('<structured_result>');
    expect(result.result).toContain('"verdict": "ok"');
  });

  test('resumes an existing child session and rejects forged task ids', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));
    state.sessions.set(
      'existing-child',
      makeSession({ id: 'existing-child', parentId: 'sess-root', preconfigId: 'explore', subagentStatus: 'completed' }),
    );

    const resumed = await executeSubagentWithDeps(baseInput({ task_id: 'existing-child' }), deps);
    expect(resumed.task_id).toBe('existing-child');
    expect(state.children[0]).toMatchObject({ childSessionId: 'existing-child', resumeFromHistory: true });
    expect(state.updates.some((entry) =>
      entry.id === 'existing-child' && entry.updates.subagentStatus === 'running')).toBe(true);

    const forged = await executeSubagentWithDeps(baseInput({ task_id: 'stranger' }), deps);
    // task_id: 'stranger' does not exist -> childSession = null -> creates a fresh child.
    expect(forged.error).toBeUndefined();

    state.sessions.set(
      'other-session-child',
      makeSession({ id: 'other-session-child', parentId: 'other-root', preconfigId: 'explore' }),
    );
    const wrongParent = await executeSubagentWithDeps(baseInput({ task_id: 'other-session-child' }), deps);
    expect(wrongParent.error).toBe('Invalid task_id: does not belong to this session');

    state.sessions.set(
      'wrong-type-child',
      makeSession({ id: 'wrong-type-child', parentId: 'sess-root', preconfigId: 'research' }),
    );
    const wrongType = await executeSubagentWithDeps(baseInput({ task_id: 'wrong-type-child' }), deps);
    expect(wrongType.error).toBe('Invalid task_id: belongs to subagent type "research", not "explore"');
  });

  test('blocks unknown, disallowed, and non-subagent targets with the exact messages', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const unknown = await executeSubagentWithDeps(baseInput({ subagent_type: 'ghost' }), deps);
    expect(unknown.error).toBe('Unknown subagent type: "ghost". Available subagents: explore, research');

    const disallowed = await executeSubagentWithDeps(baseInput({ subagent_type: 'research', allowedSubagentIds: ['explore'] }), deps);
    expect(disallowed.error).toBe('Subagent type "research" is not allowed for this agent. Allowed types: explore, agent-x');
  });

  test('blocks self-delegation without allowSelfAsSubagent and repeated ancestry', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));
    deps.preconfigs.getPreconfigOrAgent = async (id) =>
      (id === 'agent-x' ? { ...SELF_PRECONFIG, allowSelfAsSubagent: false } : null);

    const selfDenied = await executeSubagentWithDeps(baseInput({ subagent_type: 'agent-x' }), deps);
    expect(selfDenied.error).toBe('Preconfig "agent-x" is not allowed to use itself as a subagent.');

    state.sessions.set('child-1', makeSession({ id: 'child-1', parentId: 'sess-root', preconfigId: 'agent-x' }));
    deps.preconfigs.getPreconfigOrAgent = async (id) =>
      (id === 'agent-x' ? { ...SELF_PRECONFIG, allowSelfAsSubagent: true } : null);
    const repeated = await executeSubagentWithDeps(
      baseInput({ sessionId: 'child-1', subagent_type: 'agent-x' }),
      deps,
    );
    expect(repeated.error).toBe('Preconfig "agent-x" is already present in this subagent chain.');
  });

  test('blocks at maximum depth and on disabled spawning', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));
    state.sessions.set('c1', makeSession({ id: 'c1', parentId: 'sess-root', preconfigId: 'explore' }));
    state.sessions.set('c2', makeSession({ id: 'c2', parentId: 'c1', preconfigId: 'explore' }));

    const depth = await executeSubagentWithDeps(baseInput({ sessionId: 'c2' }), deps);
    expect(depth.error).toBe('Maximum subagent depth (2) reached. Cannot spawn more subagents.');

    deps.preconfigs.getPreconfigOrAgent = async () => ({ ...SELF_PRECONFIG, canSpawnSubagents: false });
    const disabled = await executeSubagentWithDeps(
      baseInput({ subagent_type: 'agent-x' }),
      deps,
    );
    expect(disabled.error).toBe('Subagent spawning is disabled for this agent.');
  });

  test('handles abort before start and the interrupted transition when aborted during execution', async () => {
    const { state, deps, answer } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const preAborted = new AbortController();
    preAborted.abort();
    const before = await executeSubagentWithDeps(baseInput({ abortSignal: preAborted.signal }), deps);
    expect(before.error).toBe('Subagent execution aborted before start');

    // Abort during execution: the abort handler is registered before the
    // child run starts, so an abort while the child runs marks the run
    // interrupted even when an answer arrives afterwards.
    const controller = new AbortController();
    const during = await executeSubagentWithDeps(
      baseInput({ abortSignal: controller.signal }),
      {
        ...deps,
        runOnHarness: async (input) => {
          state.children.push(input);
          controller.abort();
          answer(input.childSessionId, 'late-answer');
          return {};
        },
      },
    );
    expect(during.error).toBe('Subagent execution was interrupted');
    expect(during.result).toBe('');
    expect(state.updates.some((entry) =>
      entry.id === during.task_id && entry.updates.subagentStatus === 'interrupted')).toBe(true);
  });
});
