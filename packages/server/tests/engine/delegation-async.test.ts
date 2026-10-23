/**
 * Async delegation: a task returns before the child finishes (async mode, a
 * wait timeout, or the child stopping for an ask) and its result then
 * reaches the parent as a delivered message; an ask on a watched child wakes
 * the parent; nothing polls.
 */

import { describe, expect, test } from 'bun:test';
import { createMemoryDelegatedTaskStore, type DelegationAskNotice } from '@prokopai/core/application/ports/delegation-host';
import type { MessageWithParts, Preconfig, Session, TextPart } from '@prokopai/sdk/types';
import {
  askTaskMessage,
  createTaskRegistry,
  finishedTaskMessage,
  type TaskHandle,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/task-registry';
import {
  executeSubagentWithDeps,
  executeTaskCancel,
  executeTaskStatus,
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
  const tasks = createMemoryDelegatedTaskStore();
  const transcripts = new Map<string, MessageWithParts[]>();
  const host = {
    harnessEnabled: () => true,
    harnessAvailable: () => true,
    maxChildren: () => 4,
    interrupt: async () => {},
    deliver: async (input: { sessionId: string; content: string; key: string }) => { deliveries.push(input); },
    onAskCreated: (listener: (ask: DelegationAskNotice) => void) => {
      askListeners.add(listener);
      return () => askListeners.delete(listener);
    },
    hasPendingAsk: () => pendingAsk,
    tasks,
  };
  const getSession = (id: string) => sessions.get(id) ?? null;
  const readTranscript = async (id: string) => transcripts.get(id) ?? [];
  const registry = createTaskRegistry({ host, getSession, readTranscript });
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
    // The child runs through host dispatch and leaves its answer in its transcript.
    runOnHarness: async (input) => {
      const text = await childDone;
      transcripts.set(input.childSessionId, [...(transcripts.get(input.childSessionId) ?? []), {
        message: { id: 'a', sessionId: input.childSessionId, role: 'assistant', createdAt: 1 } as MessageWithParts['message'],
        parts: [{ id: 'pa', messageId: 'a', createdAt: 1, type: 'text', text } as TextPart],
      }]);
      return {};
    },
    registry,
    host,
    readTranscript,
  };
  const emitAsk = (ask: DelegationAskNotice) => { for (const listener of askListeners) listener(ask); };
  return {
    deps, sessions, deliveries, registry, emitAsk, tasks, transcripts,
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

  test('task_status reports a child of this session and task_cancel stops a running one', async () => {
    const h = harness();
    const interrupted: string[] = [];
    const deps = {
      ...h.deps,
      readTranscript: async () => [{
        message: { id: 'a', sessionId: 'c', role: 'assistant', createdAt: 1 } as never,
        parts: [{ id: 'p', messageId: 'a', createdAt: 1, type: 'text', text: 'the answer' } as TextPart],
      }],
      host: {
        harnessEnabled: () => true, harnessAvailable: () => true, maxChildren: () => 4,
        deliver: async () => {}, onAskCreated: () => () => {}, hasPendingAsk: () => false,
        interrupt: async (id: string) => { interrupted.push(id); },
      },
    };
    const started = await executeSubagentWithDeps(ask({ mode: 'async' }), h.deps);

    const running = await executeTaskStatus({ task_id: started.task_id, sessionId: 'root' }, deps);
    expect(running).toMatchObject({ status: 'running', harness: 'prokop', model: 'm', result: null, pendingAsk: false });
    expect(await executeTaskStatus({ task_id: started.task_id, sessionId: 'someone-else' }, deps)).toMatchObject({ code: 'task_not_found' });
    expect(await executeTaskStatus({ task_id: 'ghost', sessionId: 'root' }, deps)).toMatchObject({ code: 'task_not_found' });

    expect(await executeTaskCancel({ task_id: started.task_id, sessionId: 'root' }, deps)).toEqual({ task_id: started.task_id, status: 'cancelled' });
    expect(interrupted).toEqual([started.task_id]);
    expect(h.sessions.get(started.task_id)?.subagentStatus).toBe('interrupted');
    expect(await executeTaskCancel({ task_id: started.task_id, sessionId: 'root' }, deps)).toEqual({ task_id: started.task_id, status: 'interrupted' });

    h.finishChild('late');
    await settle();
    h.sessions.set(started.task_id, { ...h.sessions.get(started.task_id)!, subagentStatus: 'completed' } as Session);
    expect(await executeTaskStatus({ task_id: started.task_id, sessionId: 'root' }, deps)).toMatchObject({ status: 'completed', result: 'the answer' });
  });

  test('the task row records the run, the watch and the delivery', async () => {
    const h = harness();
    const started = await executeSubagentWithDeps(ask({ mode: 'async' }), h.deps);
    expect(h.tasks.get(started.task_id)).toMatchObject({ parentSessionId: 'root', serial: 1, watched: true, settled: false, deliveredSerial: 0, harness: 'prokop', model: 'm' });

    h.finishChild('done');
    await settle();
    expect(h.tasks.get(started.task_id)).toMatchObject({ settled: true, deliveredSerial: 1 });
    expect(h.tasks.listUndelivered()).toEqual([]);
  });

  test('a retried call with the same clientRequestId returns the same task instead of a second child', async () => {
    const h = harness();
    const first = await executeSubagentWithDeps(ask({ mode: 'async', clientRequestId: 'review-round-1' }), h.deps);
    const again = await executeSubagentWithDeps(ask({ mode: 'async', clientRequestId: 'review-round-1' }), h.deps);

    expect(again.task_id).toBe(first.task_id);
    expect(again).toMatchObject({ status: 'running' });
    expect(again.result).toContain('already running');
    expect([...h.sessions.keys()].filter((id) => id !== 'root')).toHaveLength(1);

    // Once settled, the retry returns the full result inline.
    h.finishChild('round one verdict');
    await settle();
    h.transcripts.set(first.task_id, [{
      message: { id: 'a', sessionId: first.task_id, role: 'assistant', createdAt: 1 } as MessageWithParts['message'],
      parts: [{ id: 'p', messageId: 'a', createdAt: 1, type: 'text', text: 'round one verdict' } as TextPart],
    }]);
    const settled = await executeSubagentWithDeps(ask({ mode: 'wait', clientRequestId: 'review-round-1' }), h.deps);
    expect(settled.status).toBeUndefined();
    expect(settled.result).toContain('<task_result>\nround one verdict\n</task_result>');
    expect([...h.sessions.keys()].filter((id) => id !== 'root')).toHaveLength(1);

    // A different request id is a new task.
    const second = await executeSubagentWithDeps(ask({ mode: 'async', clientRequestId: 'review-round-2' }), h.deps);
    expect(second.task_id).not.toBe(first.task_id);
  });

  test('a restart delivers a settled result the previous process never sent', async () => {
    const h = harness();
    h.sessions.set('old-child', session({ id: 'old-child', parentId: 'root', preconfigId: 'explore', subagentStatus: 'completed' }));
    h.tasks.upsert({
      taskId: 'old-child', parentSessionId: 'root', kind: 'child', worktreeId: null, branch: null, requestKey: null, description: 'Old review', harness: 'codex-cli', model: 'gpt-5.5',
      serial: 2, watched: true, settled: true, deliveredSerial: 1, createdAt: '', updatedAt: '',
    });
    h.transcripts.set('old-child', [{
      message: { id: 'a', sessionId: 'old-child', role: 'assistant', createdAt: 1 } as MessageWithParts['message'],
      parts: [{ id: 'p', messageId: 'a', createdAt: 1, type: 'text', text: 'late verdict' } as TextPart],
    }]);
    // Already delivered rows are left alone.
    h.sessions.set('done-child', session({ id: 'done-child', parentId: 'root', subagentStatus: 'completed' }));
    h.tasks.upsert({ taskId: 'done-child', parentSessionId: 'root', kind: 'child', worktreeId: null, branch: null, requestKey: null, description: 'Done', harness: 'prokop', model: null,
      serial: 1, watched: true, settled: true, deliveredSerial: 1, createdAt: '', updatedAt: '' });

    expect(await h.registry.recover()).toBe(1);
    expect(h.deliveries).toEqual([{
      sessionId: 'root',
      key: 'task-result:old-child:2',
      content: expect.stringContaining('[task old-child "Old review" on codex-cli/gpt-5.5 finished]'),
    }]);
    expect(h.deliveries[0]!.content).toContain('<task_result>\nlate verdict\n</task_result>');
    expect(h.tasks.get('old-child')?.deliveredSerial).toBe(2);
    expect(await h.registry.recover()).toBe(0);
  });

  test('messages name the task, the role run and the outcome', () => {
    const handle: TaskHandle = { taskId: 't1', parentSessionId: 'root', description: 'Review', harness: 'codex-cli', model: 'gpt-5.5', run: Promise.resolve({ task_id: 't1', result: '' }) };
    expect(finishedTaskMessage(handle, { task_id: 't1', result: '', error: 'boom' })).toBe('[task t1 "Review" on codex-cli/gpt-5.5 failed]\nboom');
    expect(finishedTaskMessage(handle, { task_id: 't1', result: 'R', error: 'partial' })).toBe('[task t1 "Review" on codex-cli/gpt-5.5 finished]\nR\nNote: partial');
    expect(askTaskMessage(handle, { sessionId: 't1', requestId: 'r', toolName: 'shell' })).toContain('[task t1 "Review" on codex-cli/gpt-5.5 needs an answer]');
  });
});
