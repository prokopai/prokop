import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Preconfig, ServerMessage } from '@prokopai/sdk';
import { getAgentAskPort } from '@prokopai/core/application/ports/agent-asks';
import type { SessionWirePorts } from '@prokopai/core/application/ports/delivery';
import { createWiredAgentsApplication } from '@/bootstrap/application';
import { bindHarnessExecutors, getAgentSupervisor } from '@/bootstrap/agent-ports';
import { createHarnessRegistrations } from '@prokopai/agent/internal/composition/harness-registrations';
import { createPreconfig } from '@prokopai/core/infrastructure/config/preconfig';
import { activateSandbox, deactivateSandbox } from '@prokopai/core/infrastructure/sandbox';
import { sandboxController } from '@prokopai/core/infrastructure/sandbox/controller';
import { listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { addMessageToQueue, getQueuedMessage } from '@/infrastructure/sqlite/queued-messages';
import { getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { resetTestDataDir, setupTestDataDir } from '#tests/test-dir';

const ENV = ['PROKOPAI_AGENT_PROCESS', 'PROKOPAI_AGENT_IDLE_MS'] as const;

const preconfig = {
  id: 'process-test', name: 'Process Test', description: 'Agent process tests', systemPrompt: 'Answer directly.',
  tools: ['question'], model: null, provider: null, settings: null, isDefault: false, mode: 'primary',
} as unknown as Preconfig;

const text = (content: string) => ({ match: { mode: 'stream' }, response: { type: 'text', content } });

/** A host wire like the transport's per-request ports, recording what reaches it. */
function recordingWire(messages: ServerMessage[]): SessionWirePorts<string> {
  const push = (message: ServerMessage): void => { messages.push(message); };
  return {
    delivery: {
      send: (_origin, message) => push(message),
      broadcast: message => push(message),
      broadcastToSession: (_sessionId, message) => push(message),
      sendToController: (_sessionId, message) => push(message),
      sendToAskTargets: (_sessionId, _authority, message) => push(message),
    },
    actor: { attachOriginToSession: () => {} },
  };
}

async function until(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

const assistantText = (sessionId: string): string[] => listMessagesWithParts(sessionId)
  .filter(entry => entry.message.role === 'assistant')
  .flatMap(entry => entry.parts.flatMap(part => part.type === 'text' ? [part.text] : []));

describe('harnesses in a supervised agent process (PROKOPAI_AGENT_PROCESS=1)', () => {
  const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
  let sessionId: string;
  let execution: ReturnType<typeof bindHarnessExecutors<ReturnType<typeof createHarnessRegistrations>>>['prokop']['execution'];

  /** Host in process mode; the agent's sandboxed model calls are answered by this process's controller. */
  async function setup(rules: unknown[], env: Partial<Record<(typeof ENV)[number], string>> = {}): Promise<void> {
    for (const key of ENV) saved[key] = process.env[key];
    const dataDir = setupTestDataDir();
    Object.assign(process.env, { PROKOPAI_AGENT_PROCESS: '1', ...env });
    setupTestDatabase();
    ({ sessionId } = seedWorkspaceWithSession({ path: dataDir }));
    await createPreconfig(preconfig);
    updateSession(sessionId, { preconfigId: preconfig.id, selectedModel: 'gpt-4o', selectedProvider: 'sandbox' });
    activateSandbox();
    sandboxController.setAutoResponderRules(rules as Parameters<typeof sandboxController.setAutoResponderRules>[0]);
    const noTitle = async () => {};
    execution = bindHarnessExecutors(createHarnessRegistrations({
      agents: createWiredAgentsApplication(), titles: { 'codex-cli': noTitle, 'claude-cli': noTitle },
    })).prokop.execution;
  }

  beforeEach(() => {});

  afterEach(async () => {
    await getAgentSupervisor()?.stop();
    deactivateSandbox();
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetTestDatabase();
    resetTestDataDir();
  });

  test('a Prokop turn runs in the agent process and lands in the host store', async () => {
    await setup([text('Hello from the agent process')]);
    const messages: ServerMessage[] = [];
    await execution.sendMessage(recordingWire(messages), 'conn-1', sessionId, 'hi');
    const pid = getAgentSupervisor()!.pid();
    expect(pid).not.toBeNull();
    expect(pid).not.toBe(process.pid);
    expect(assistantText(sessionId).join('')).toBe('Hello from the agent process');
    expect(messages.some(message => message.type === 'message.created')).toBe(true);
    expect(execution.isSessionActive(sessionId)).toBe(false);
  }, 30_000);

  test('a question asked in the agent is answered through the host', async () => {
    await setup([
      { match: { mode: 'stream', hasToolResults: false },
        response: { type: 'tool-call', toolName: 'question', args: { title: 'Pick', questions: [{ type: 'text', question: 'Color?' }] } } },
      { match: { mode: 'stream', hasToolResults: true }, response: { type: 'text', content: 'Blue it is.' } },
    ]);
    const messages: ServerMessage[] = [];
    const turn = execution.sendMessage(recordingWire(messages), 'conn-1', sessionId, 'ask me');
    await until(() => messages.some(message => message.type === 'ask.request'), 'the ask');
    const ask = messages.find(message => message.type === 'ask.request') as Extract<ServerMessage, { type: 'ask.request' }>;
    expect(await getAgentAskPort()!.lookup(ask.toolCallId, ask.requestId)).toMatchObject({ sessionId });
    expect(await getAgentAskPort()!.resolve({ sessionId, toolCallId: ask.toolCallId, requestId: ask.requestId,
      response: { type: 'form', answers: [{ question: 'Color?', answer: 'blue' }] } })).toBe(true);
    await turn;
    expect(assistantText(sessionId).join('')).toBe('Blue it is.');
  }, 30_000);

  test('a sandbox client on the host answers the model call the agent is waiting on', async () => {
    await setup([]);
    const turn = execution.sendMessage(recordingWire([]), 'conn-1', sessionId, 'hello?');
    await until(() => sandboxController.getPendingCalls().length === 1, 'the waiting model call');
    const [call] = sandboxController.getPendingCalls();
    expect(call!.sessionId).toBe(sessionId);
    sandboxController.respond(call!.callId, { type: 'text', content: 'Answered from the host' });
    await turn;
    expect(assistantText(sessionId).join('')).toBe('Answered from the host');
    await until(() => sandboxController.getHistory().some(entry => entry.callId === call!.callId && entry.completedAt !== null),
      'the completed call');
  }, 30_000);

  test('a steer message queued during a step reaches the next model call in the agent', async () => {
    await setup([
      { match: { mode: 'stream', hasToolResults: false },
        response: { type: 'tool-call', toolName: 'question', args: { title: 'Pick', questions: [{ type: 'text', question: 'Color?' }] } } },
      { match: { mode: 'stream', hasToolResults: true }, response: { type: 'text', content: 'Steered.' } },
    ]);
    const messages: ServerMessage[] = [];
    const turn = execution.sendMessage(recordingWire(messages), 'conn-1', sessionId, 'start');
    await until(() => messages.some(message => message.type === 'ask.request'), 'the ask');
    // The ask holds the first step open while the steer row is queued.
    const steer = addMessageToQueue(sessionId, 'Also mention green.', undefined, true);
    const ask = messages.find(message => message.type === 'ask.request') as Extract<ServerMessage, { type: 'ask.request' }>;
    await getAgentAskPort()!.resolve({ sessionId, toolCallId: ask.toolCallId, requestId: ask.requestId,
      response: { type: 'form', answers: [{ question: 'Color?', answer: 'blue' }] } });
    await turn;
    expect(getQueuedMessage(steer.id)).toBeNull();
    const second = sandboxController.getHistory().at(-1)!;
    expect(JSON.stringify(second.context.messages)).toContain('Also mention green.');
    expect(assistantText(sessionId).join('')).toBe('Steered.');
  }, 30_000);

  test('interrupt reaches a turn waiting in the agent', async () => {
    // No rule matches: the sandboxed model call waits on the host controller until interrupted.
    await setup([]);
    const messages: ServerMessage[] = [];
    const turn = execution.sendMessage(recordingWire(messages), 'conn-1', sessionId, 'wait');
    // Right after the user message, before the model call registers: the interrupt must still land.
    await until(() => messages.some(message => message.type === 'message.created'), 'the user message');
    expect(execution.isSessionActive(sessionId)).toBe(true);
    expect((await execution.interruptSession(sessionId)).success).toBe(true);
    await turn;
    expect(execution.isSessionActive(sessionId)).toBe(false);
  }, 30_000);

  test('an agent crash mid-turn fails the turn, recovers the session and the next turn respawns', async () => {
    await setup([]);
    const messages: ServerMessage[] = [];
    const turn = execution.sendMessage(recordingWire(messages), 'conn-1', sessionId, 'wait');
    await until(() => messages.some(message => message.type === 'message.created'), 'the turn to start');
    const pid = getAgentSupervisor()!.pid()!;
    process.kill(pid, 'SIGKILL');
    await expect(turn).rejects.toThrow();
    await until(() => !getSession(sessionId)?.runningAt, 'running flag recovery');
    expect(execution.isSessionActive(sessionId)).toBe(false);

    sandboxController.setAutoResponderRules([text('Back again')] as Parameters<typeof sandboxController.setAutoResponderRules>[0]);
    await execution.sendMessage(recordingWire([]), 'conn-1', sessionId, 'again');
    expect(getAgentSupervisor()!.pid()).not.toBe(pid);
    expect(assistantText(sessionId).join('')).toContain('Back again');
  }, 30_000);

  test('an idle agent process exits and the next request starts a new one', async () => {
    await setup([text('one'), text('two')].map(rule => ({ ...rule, maxUses: 1 })), { PROKOPAI_AGENT_IDLE_MS: '200' });
    await execution.sendMessage(recordingWire([]), 'conn-1', sessionId, 'first');
    const first = getAgentSupervisor()!.pid();
    await until(() => getAgentSupervisor()!.pid() === null, 'idle exit');
    await execution.sendMessage(recordingWire([]), 'conn-1', sessionId, 'second');
    expect(getAgentSupervisor()!.pid()).not.toBe(first);
  }, 30_000);
});
