import { afterEach, describe, expect, test } from 'bun:test';
import type { AgentHandlers } from '@prokopai/agent-protocol';
import type { ServerMessage } from '@prokopai/sdk';
import { createTurnHandlers, type AgentExecutor } from '@/agent-bridge/agent-turns';
import { createTurnForwarding } from '@/agent-bridge/host-turns';
import { createAgentLoopback } from '@/agent-bridge/loopback';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { bindHarnessExecutors, onHarnessWorktreeChanged } from '@/bootstrap/agent-ports';
import { harnessProbes } from '@/application/ports/harness-probes';
import { getHarnessNotificationPort } from '@/application/ports/harness-notifications';
import { prokopCompatibilityBindings } from '@/harnesses/prokop/composition/bindings';
import { prokopStorageBundle } from '@/harnesses/prokop/host/storage';
import { configureRuntimeHost } from '@/infrastructure/runtime/host';
import { configureStorage } from '@/infrastructure/storage/runtime';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';

type Call = [string, ...unknown[]];

/** A host wire that records every call with its origin, like the transport's per-request ports. */
function recordingWire(calls: Call[]): SessionWirePorts<string> {
  return {
    delivery: {
      send: (origin, message) => calls.push(['send', origin, message.type]),
      broadcast: (message, exclude) => calls.push(['broadcast', message.type, exclude]),
      broadcastToSession: (sessionId, message, exclude) => calls.push(['broadcastToSession', sessionId, message.type, exclude]),
      sendToController: (sessionId, message) => calls.push(['sendToController', sessionId, message.type]),
      sendToAskTargets: (sessionId, _authority, message) => calls.push(['sendToAskTargets', sessionId, message.type]),
    },
    actor: { attachOriginToSession: (origin, sessionId) => calls.push(['attach', origin, sessionId]) },
  };
}

const error = (message: string): ServerMessage => ({ type: 'error', code: 'invalid_session', message, sessionId: 's1' });
const updated = { type: 'session.updated', session: { id: 's1' } } as unknown as ServerMessage;

/**
 * A scripted executor: what it does with its wire must arrive unchanged on
 * the host wire, whether called directly or through `turn.*`.
 */
function scriptedExecutor(state: { activeAfter: Set<string>; running: Set<string> }): AgentExecutor {
  return {
    async sendMessage(wire, origin, sessionId, content) {
      state.running.add(sessionId);
      wire.actor.attachOriginToSession(origin, sessionId);
      wire.delivery.broadcastToSession(sessionId, updated, origin);
      wire.delivery.send(origin, error(`echo ${content}`));
      wire.delivery.sendToController(sessionId, updated);
      wire.delivery.broadcast(updated);
      await Bun.sleep(5);
      state.running.delete(sessionId);
    },
    interruptSession: async sessionId => ({ sessionId, success: true, cascadedTo: [], interruptedTools: [], rejectedAsks: [] }),
    isSessionActive: sessionId => state.running.has(sessionId) || state.activeAfter.has(sessionId),
    async compact(sessionId, _reason, delivery) {
      delivery?.broadcastToSession(sessionId, updated);
      return { ok: true, result: { tokensUsed: { prompt: 0, completion: 0 } } };
    },
    fork: async input => ({ forkedSession: { id: 'fork', workspaceId: 'w1', title: input.title } as never, messages: [] }),
  };
}

describe('execution over the agent protocol loopback', () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });

  function forwarded(executor: AgentExecutor): { forwarding: AgentExecutor; fallback: unknown[] } {
    const fallback: unknown[] = [];
    const turns = createTurnForwarding(() => host, params => fallback.push(params));
    const agentHandlers: AgentHandlers = {};
    const { agent, host, close } = createAgentLoopback({ handlers: {}, notifications: turns.notifications }, agentHandlers);
    closers.push(close);
    Object.assign(agentHandlers, createTurnHandlers(agent, { 'codex-cli': executor }));
    return { forwarding: turns.executorFor('codex-cli', executor), fallback };
  }

  test('a turn reaches the host wire exactly as a direct call does', async () => {
    const direct: Call[] = [];
    await scriptedExecutor({ activeAfter: new Set(), running: new Set() })
      .sendMessage(recordingWire(direct), 'conn-1', 's1', 'hi');

    const viaProtocol: Call[] = [];
    const { forwarding, fallback } = forwarded(scriptedExecutor({ activeAfter: new Set(), running: new Set() }));
    const turn = forwarding.sendMessage(recordingWire(viaProtocol), 'conn-1', 's1', 'hi');
    expect(forwarding.isSessionActive('s1')).toBe(true);
    await turn;
    expect(forwarding.isSessionActive('s1')).toBe(false);

    expect(viaProtocol).toEqual(direct);
    expect(direct).toEqual([
      ['attach', 'conn-1', 's1'],
      ['broadcastToSession', 's1', 'session.updated', 'conn-1'],
      ['send', 'conn-1', 'error'],
      ['sendToController', 's1', 'session.updated'],
      ['broadcast', 'session.updated', undefined],
    ]);
    expect(fallback).toEqual([]);
  });

  test('activity that outlives the request is reported by the agent', async () => {
    const state = { activeAfter: new Set(['s1']), running: new Set<string>() };
    const { forwarding } = forwarded(scriptedExecutor(state));
    await forwarding.sendMessage(recordingWire([]), 'conn-1', 's1', 'hi');
    await Bun.sleep(1);
    expect(forwarding.isSessionActive('s1')).toBe(true);
    // The background work ends; the next event about the session reports it.
    state.activeAfter.clear();
    await forwarding.interruptSession('s1');
    await Bun.sleep(1);
    expect(forwarding.isSessionActive('s1')).toBe(false);
  });

  test('optional operations keep their presence; compact keeps "no delivery"; fork returns the result', async () => {
    const { forwarding } = forwarded(scriptedExecutor({ activeAfter: new Set(), running: new Set() }));
    expect(forwarding.editMessage).toBeUndefined();
    expect(forwarding.revert).toBeUndefined();

    const calls: Call[] = [];
    expect(await forwarding.compact!('s1', 'manual', recordingWire(calls).delivery)).toMatchObject({ ok: true });
    expect(calls).toEqual([['broadcastToSession', 's1', 'session.updated', undefined]]);
    expect(await forwarding.compact!('s1', 'manual')).toMatchObject({ ok: true });

    expect(await forwarding.fork!({ sessionId: 's1', targetMessageId: 'm1', title: 'Copy' }))
      .toMatchObject({ forkedSession: { id: 'fork', workspaceId: 'w1', title: 'Copy' }, messages: [] });
  });
});

describe('bootstrap binds harness executors to the agent loopback', () => {
  afterEach(() => {
    delete process.env.PROKOPAI_AGENT_LOOPBACK;
    configureStorage(prokopStorageBundle);
    configureRuntimeHost(prokopCompatibilityBindings);
    resetTestDatabase();
  });

  test('with the flag, every registration forwards over turn.* to its own executor', async () => {
    process.env.PROKOPAI_AGENT_LOOPBACK = '1';
    setupTestDatabase();
    const state = { activeAfter: new Set<string>(), running: new Set<string>() };
    const codex = scriptedExecutor(state);
    const bound = bindHarnessExecutors({
      prokop: { execution: scriptedExecutor({ activeAfter: new Set(), running: new Set() }) },
      'codex-cli': { execution: codex },
      'claude-cli': { execution: scriptedExecutor({ activeAfter: new Set(), running: new Set() }) },
    });
    expect(bound['codex-cli'].execution).not.toBe(codex);
    const calls: Call[] = [];
    await bound['codex-cli'].execution.sendMessage(recordingWire(calls), 'conn-1', 's1', 'hi');
    expect(calls).toContainEqual(['send', 'conn-1', 'error']);
  });

  test('without the flag the registrations are returned unchanged', () => {
    setupTestDatabase();
    const registrations = { prokop: { execution: scriptedExecutor({ activeAfter: new Set(), running: new Set() }) },
      'codex-cli': { execution: scriptedExecutor({ activeAfter: new Set(), running: new Set() }) },
      'claude-cli': { execution: scriptedExecutor({ activeAfter: new Set(), running: new Set() }) } };
    expect(bindHarnessExecutors(registrations)).toBe(registrations);
  });
});

describe('headless runs, probes and harness events over the agent loopback', () => {
  afterEach(() => {
    delete process.env.PROKOPAI_AGENT_LOOPBACK;
    configureStorage(prokopStorageBundle);
    configureRuntimeHost(prokopCompatibilityBindings);
    resetTestDatabase();
  });

  test('a headless run crosses as turn.headless and its child session counts as active', async () => {
    process.env.PROKOPAI_AGENT_LOOPBACK = '1';
    setupTestDatabase();
    let release!: () => void;
    const runs: string[] = [];
    const bound = bindHarnessExecutors({
      prokop: { execution: scriptedExecutor({ activeAfter: new Set(), running: new Set() }),
        headless: async (input) => {
          runs.push(input.childSessionId);
          await new Promise<void>(resolve => { release = resolve; });
          return { error: 'done' };
        } },
      'codex-cli': { execution: scriptedExecutor({ activeAfter: new Set(), running: new Set() }) },
      'claude-cli': { execution: scriptedExecutor({ activeAfter: new Set(), running: new Set() }) },
    });
    expect((bound['codex-cli'] as { headless?: unknown }).headless).toBeUndefined();
    const run = bound.prokop.headless!({ harness: 'prokop', parentSessionId: 'p', childSessionId: 'child',
      preconfig: { id: 'agent', name: 'Agent' } as never, prompt: 'go', workspacePath: undefined, workspaceId: 'ws',
      modelId: 'm', providerId: 'p', resumeFromHistory: false });
    for (let attempt = 0; attempt < 50 && !runs.length; attempt++) await Bun.sleep(1);
    expect(runs).toEqual(['child']);
    expect(bound.prokop.execution.isSessionActive('child')).toBe(true);
    release();
    expect(await run).toEqual({ error: 'done' });
    expect(bound.prokop.execution.isSessionActive('child')).toBe(false);
  });

  test('probes are agent requests and a worktree change reaches the host listener as an event', async () => {
    process.env.PROKOPAI_AGENT_LOOPBACK = '1';
    setupTestDatabase();
    // No Claude binding: the agent reads no native title.
    expect(await harnessProbes().nativeTitle('missing')).toBeNull();
    const changed: string[] = [];
    onHarnessWorktreeChanged(id => changed.push(id));
    getHarnessNotificationPort()?.notifyWorktreeChanged?.('wt-1');
    await Bun.sleep(1);
    expect(changed).toEqual(['wt-1']);
  });
});
