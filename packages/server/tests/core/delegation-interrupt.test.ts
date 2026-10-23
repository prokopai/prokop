/**
 * Stopping a delegated Prokop child after its parent stopped waiting. Stop on
 * the parent cascades through the interrupt manager, Stop on the child and
 * task_cancel call it directly; all three must end the child's run, not only
 * flip its status.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import type { Preconfig, Session } from '@prokopai/sdk/types';
import { splitHostEvent } from '@prokopai/sdk';
import { createMemoryDelegatedTaskStore } from '@prokopai/core/application/ports/delegation-host';
import { withRuntimeHost, type RuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { interruptManager } from '@prokopai/agent/internal/harnesses/prokop/execution/interrupt';
import { createProkopHeadlessExecution } from '@prokopai/agent/internal/harnesses/prokop/execution';
import { createTaskRegistry } from '@prokopai/agent/internal/harnesses/prokop/subagent/task-registry';
import { executeSubagentWithDeps, type SubagentServiceDeps } from '@prokopai/agent/internal/harnesses/prokop/subagent/task-tool';

const EXPLORE: Preconfig = {
  id: 'explore', name: 'Explore', description: 'Explores', systemPrompt: '', tools: null, model: null, provider: null,
  variant: null, settings: null, isDefault: false, mode: 'subagent', canSpawnSubagents: false,
};

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
    titles: { isDefaultSessionTitle: () => true, hasManualSessionTitle: () => false, generateSessionTitle: async () => null },
    workspace: {
      createToolWorkspaceHost: () => ({ root: '/tmp', additionalRoots: undefined, allowedRoots: [], tempDir: '/tmp/delegation-interrupt-test', getEnvironmentValue: () => undefined }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

beforeEach(() => { setupTestDatabase(); });
afterEach(() => { resetTestDatabase(); });

test('an interrupt after the parent stopped waiting ends the child run and reports it', async () => {
  const sessions = new Map<string, Session>([['root', {
    id: 'root', workspaceId: 'ws-1', preconfigId: 'dev', title: 'Root', status: 'active', metadata: null,
    createdAt: '', updatedAt: '', parentId: null, agentName: null, harness: 'prokop', selectedModel: 'm', selectedProvider: 'p',
  } as Session]]);
  const deliveries: Array<{ sessionId: string; content: string; key: string }> = [];
  const host = {
    harnessEnabled: () => true, harnessAvailable: () => true, maxChildren: () => 4,
    interrupt: async () => {}, deliver: async (input: { sessionId: string; content: string; key: string }) => { deliveries.push(input); },
    onAskCreated: () => () => {}, hasPendingAsk: () => false, tasks: createMemoryDelegatedTaskStore(),
  };
  const getSession = (id: string) => sessions.get(id) ?? null;
  let childSignal: AbortSignal | undefined;
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
    preconfigs: { getPreconfigOrAgent: async (id) => (id === 'explore' ? EXPLORE : null), listSubagentPreconfigs: async () => [EXPLORE] },
    broadcasts: { event: () => {}, sessionCreated: () => {}, sessionUpdated: () => {}, toSession: () => {} },
    // The real Prokop headless dispatch over a child run that ends only when
    // it is stopped, like a child in the middle of a long tool call.
    runOnHarness: createProkopHeadlessExecution({
      executeChildSession: async (options) => {
        childSignal = options.abortSignal;
        await new Promise<void>((resolve) => options.abortSignal?.addEventListener('abort', () => resolve(), { once: true }));
        return { parts: [] };
      },
    }),
    registry: createTaskRegistry({ host, getSession, readTranscript: async () => [] }),
    host,
    readTranscript: async () => [],
  };

  const started = await executeSubagentWithDeps({
    description: 'Map the repo', prompt: 'Go', subagent_type: 'explore', sessionId: 'root', workspaceId: 'ws-1', mode: 'async',
  } as Parameters<typeof executeSubagentWithDeps>[0], deps);
  expect(started.status).toBe('running');
  // The run enters the headless dispatch after the async call returned.
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(childSignal?.aborted).toBe(false);
  // Registered for its whole run, so the host's interrupt finds something to abort.
  expect(interruptManager.isSessionActive(started.task_id)).toBe(true);

  await withRuntimeHost(minimalHost(), () => interruptManager.interruptSession(started.task_id, 'user_request'));
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(childSignal?.aborted).toBe(true);
  expect(interruptManager.isSessionActive(started.task_id)).toBe(false);
  expect(sessions.get(started.task_id)?.subagentStatus).toBe('interrupted');
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]!.content).toContain('Subagent execution was interrupted');
  expect(splitHostEvent(deliveries[0]!.content).event).toMatchObject({ kind: 'task', id: started.task_id, outcome: 'error' });
});
