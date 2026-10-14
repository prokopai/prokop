import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AskRequestMessage, AskTimedOutMessage } from '@prokopai/sdk';
import { getAgentAskPort } from '@/application/ports/agent-asks';
import {
  disposeProkopExecutionScope,
  initializeProkopExecutionScope,
  resetProkopExecutionCompositionFactoryForTests,
  withProkopExecutionScope,
} from '@/harnesses/prokop/composition/execution-scope';
import { createAskApi } from '@/harnesses/prokop/permission/ask-user-api';
import { resetTestDatabase, restoreConfiguredRuntime, setupTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';

/**
 * With PROKOPAI_AGENT_LOOPBACK=1 a Prokop ask's waiter is looked up
 * (`ask.lookup`) and answered (`ask.resolve`) across the agent protocol,
 * the same route Claude Code and Codex asks take.
 */
describe('Prokop asks over the agent protocol loopback', () => {
  let sessionId: string;
  let workspaceId: string;

  beforeEach(async () => {
    process.env.PROKOPAI_AGENT_LOOPBACK = '1';
    setupTestDatabase();
    ({ sessionId, workspaceId } = seedWorkspaceWithSession());
    await initializeProkopExecutionScope();
  });

  afterEach(async () => {
    await disposeProkopExecutionScope();
    resetProkopExecutionCompositionFactoryForTests();
    delete process.env.PROKOPAI_AGENT_LOOPBACK;
    restoreConfiguredRuntime();
    resetTestDatabase();
  });

  test('lookup and answer reach the composed waiter through the protocol', async () => {
    let seen = () => {};
    const requested = new Promise<void>(resolve => { seen = resolve; });
    const broadcastFn = (message: AskRequestMessage | AskTimedOutMessage) => {
      if (message.type === 'ask.request') seen();
    };
    let answer: Promise<unknown> | undefined;
    await withProkopExecutionScope(async () => {
      answer = createAskApi(sessionId, 'call_loopback', 'question', broadcastFn, workspaceId, sessionId)(
        { type: 'confirm', question: 'Proceed?', target: 'human' });
      await requested;
    });

    const port = getAgentAskPort()!;
    expect(await port.lookup('call_loopback')).toEqual({ sessionId,
      authority: { visibilityScope: 'controller_only', resolutionMode: 'controller_only' } });
    expect(await port.lookup('call_missing')).toBeNull();
    expect(await port.resolve({ sessionId, toolCallId: 'call_loopback', response: { type: 'confirm', confirmed: true } }))
      .toBe(true);
    expect(await answer).toBe(true);
  });
});
