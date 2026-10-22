/**
 * Async delegation: a task returns before the child finishes (async mode, a
 * wait timeout, or the child stopping for an ask) and its result then
 * reaches the parent as a delivered message; an ask on a watched child wakes
 * the parent; nothing polls.
 */

import { describe, expect, test } from 'bun:test';
import type { DelegationAskNotice } from '@prokopai/core/application/ports/delegation-host';
import type { Preconfig, Session, TextPart } from '@prokopai/sdk/types';
import {
  askTaskMessage,
  createTaskRegistry,
  finishedTaskMessage,
  type TaskHandle,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/task-registry';
import {
  executeSubagentWithDeps,
  type SubagentServiceDeps,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/task-tool';

const DEV: Preconfig = {
  id: 'dev', name: 'Dev', description: 'Builds', systemPrompt: '', tools: null, model: null, provider: null,
  variant: null, settings: null, isDefault: false, mode: 'both', canSpawnSubagents: true,
};
const EXPLORE: Preconfig = { ...DEV, id: 'explore', name: 'Explore', description: 'Explores', mode: 'subagent' };

function session(overrides: Partial<Session>): Session {
  return {
    id: 'root', workspaceId: 'ws-1', preconfigId: 'dev', title: 'Root', status: 'active', metadata: null,
    createdAt: '', updatedAt: '', parentId: null, agentName: null, harness: 'prokop', selectedModel: 'm', selectedProvider: 'p',
    ...overrides,
  } as Session;
}

function harness() {
  const sessions = new Map<string, Session>([['root', session({ id: 'root' })]]);
  const deliveries: Array<{ sessionId: string; content: string; key: string }> = [];
  const askListeners = new Set<(ask: DelegationAskNotice) => void>();
  let pendingAsk = false;
  const host = {
    deliver: async (input: { sessionId: string; content: string; key: string }) => { deliveries.push(input); },
    onAskCreated: (listener: (ask: DelegationAskNotice) => void) => {
      askListeners.add(listener);
      return () => askListeners.delete(listener);
    },
    hasPendingAsk: () => pendingAsk,
  };
  const getSession = (id: string) => sessions.get(id) ?? null;
  const registry = createTaskRegistry({ host, getSession });
  let finishChild: (text: string) => void = () => {};
  const childDone = new Promise<string>((resolve) => { finishChild = resolve; });
  const deps: SubagentServiceDeps = {
    sessionAccess: {
      getSession,
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
    },
    preconfigs: {
      getPreconfigOrAgent: async (id) => [DEV, EXPLORE].find((preconfig) => preconfig.id === id) ?? null,
      listSubagentPreconfigs: async () => [EXPLORE],
    },
    broadcasts: { event: () => {}, sessionCreated: () => {}, sessionUpdated: () => {}, toSession: () => {} },
    executeChild: async () => {
      const text = await childDone;
      return { parts: [{ id: 'p', messageId: 'm', createdAt: 0, type: 'text', text } as TextPart] };
    },
    registry,
  };
  const emitAsk = (ask: DelegationAskNotice) => { for (const listener of askListeners) listener(ask); };
  return {
    deps, sessions, deliveries, registry, emitAsk,
    finishChild: (text: string) => finishChild(text),
    setPendingAsk: (value: boolean) => { pendingAsk = value; },
    listeners: askListeners,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const ask = (overrides: Record<string, unknown>) => ({
  description: 'Map the repo', prompt: 'Go', subagent_type: 'explore', sessionId: 'root', workspaceId: 'ws-1', ...overrides,
}) as Parameters<typeof executeSubagentWithDeps>[0];

describe('async delegation', () => {
  test('async mode returns at once and the result arrives as a delivery when the child finishes', async () => {
    const h = harness();

    const result = await executeSubagentWithDeps(ask({ mode: 'async' }), h.deps);

    expect(result).toMatchObject({ status: 'running', harness: 'prokop', model: 'm', waitTimedOut: false, pendingAsk: false });
    expect(result.result).toContain('do not poll');
    expect(h.registry.isWatched(result.task_id)).toBe(true);
    expect(h.deliveries).toEqual([]);

    h.finishChild('the map');
    await settle();
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]).toMatchObject({ sessionId: 'root', key: `task-result:${result.task_id}:1` });
    expect(h.deliveries[0]!.content).toStartWith(`[task ${result.task_id} "Map the repo" on prokop/m finished]\ntask_id: ${result.task_id}`);
    expect(h.deliveries[0]!.content).toContain('<task_result>\nthe map\n</task_result>');
    expect(h.sessions.get(result.task_id)?.subagentStatus).toBe('completed');
    expect(h.registry.isWatched(result.task_id)).toBe(false);
  });

  test('a wait that times out turns async: the call returns, the child keeps running, the result is delivered later', async () => {
    const h = harness();

    const result = await executeSubagentWithDeps(ask({ timeoutMs: 20 }), h.deps);

    expect(result).toMatchObject({ status: 'running', waitTimedOut: true, pendingAsk: false });
    expect(result.result).toContain('timed out; the task was not cancelled');
    h.finishChild('late answer');
    await settle();
    expect(h.deliveries.map((entry) => entry.content.includes('late answer'))).toEqual([true]);
  });

  test('a wait ends when the child asks something; the ask then wakes the parent as a delivery', async () => {
    const h = harness();

    const pending = executeSubagentWithDeps(ask({}), h.deps);
    await settle();
    const childId = [...h.sessions.keys()].find((id) => id !== 'root')!;
    h.emitAsk({ sessionId: childId, requestId: 'req-1', toolName: 'shell' });
    const result = await pending;

    expect(result).toMatchObject({ status: 'running', pendingAsk: true, waitTimedOut: false });
    expect(result.result).toContain('waiting for the user to answer');

    // The task is watched now: a further ask wakes the parent, once per request.
    h.emitAsk({ sessionId: childId, requestId: 'req-2', toolName: 'edit' });
    await settle();
    expect(h.deliveries).toEqual([{ sessionId: 'root', key: 'task-ask:req-2', content: expect.stringContaining('needs an answer') }]);
    // An ask on an unrelated session is ignored.
    h.emitAsk({ sessionId: 'elsewhere', requestId: 'req-3', toolName: 'edit' });
    await settle();
    expect(h.deliveries).toHaveLength(1);

    h.finishChild('done after asks');
    await settle();
    expect(h.deliveries).toHaveLength(2);
    expect(h.listeners.size).toBe(0);
  });

  test('a child already blocked on an ask ends the wait immediately', async () => {
    const h = harness();
    h.setPendingAsk(true);

    const result = await executeSubagentWithDeps(ask({}), h.deps);
    expect(result).toMatchObject({ status: 'running', pendingAsk: true });
  });

  test('a plain wait still returns the result inline with the unchanged shape', async () => {
    const h = harness();
    const pending = executeSubagentWithDeps(ask({}), h.deps);
    h.finishChild('inline');
    const result = await pending;

    expect(result.status).toBeUndefined();
    expect(result.result).toContain('<task_result>\ninline\n</task_result>');
    expect(h.deliveries).toEqual([]);
  });

  test('messages name the task, the role run and the outcome', () => {
    const handle: TaskHandle = { taskId: 't1', parentSessionId: 'root', description: 'Review', harness: 'codex-cli', model: 'gpt-5.5', run: Promise.resolve({ task_id: 't1', result: '' }) };
    expect(finishedTaskMessage(handle, { task_id: 't1', result: '', error: 'boom' })).toBe('[task t1 "Review" on codex-cli/gpt-5.5 failed]\nboom');
    expect(finishedTaskMessage(handle, { task_id: 't1', result: 'R', error: 'partial' })).toBe('[task t1 "Review" on codex-cli/gpt-5.5 finished]\nR\nNote: partial');
    expect(askTaskMessage(handle, { sessionId: 't1', requestId: 'r', toolName: 'shell' })).toContain('[task t1 "Review" on codex-cli/gpt-5.5 needs an answer]');
  });
});
