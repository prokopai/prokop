import { beforeEach, describe, expect, test } from 'bun:test';
import type { Preconfig } from '@prokopai/sdk';
import { createRuntime } from '@/bootstrap/create-runtime';
import { buildSystemMessage } from '@prokopai/agent/internal/harnesses/prokop/composition/plugins/legacy-system-message';

const preconfig: Preconfig = {
  id: 'self-delegating-agent-test',
  name: 'Self-delegating agent test',
  description: 'Test preconfig',
  systemPrompt: 'Base system prompt',
  tools: null,
  model: null,
  provider: null,
  settings: null,
  isDefault: false,
};

describe('buildSystemMessage self-delegation guidance', () => {
  beforeEach(() => createRuntime());
  test('announces self-delegation when it is available', async () => {
    const message = await buildSystemMessage({
      preconfig,
      selfDelegationAvailable: true,
    });

    expect(message).toContain('SELF-DELEGATION:');
    expect(message).toContain('subagent_type "self-delegating-agent-test"');
    expect(message).toContain('only to the immediate child');
  });

  test('omits self-delegation guidance when it is unavailable', async () => {
    const message = await buildSystemMessage({ preconfig });

    expect(message).not.toContain('SELF-DELEGATION:');
    expect(message).not.toContain('delegate_task');
  });

  test('explains delegate_task when the tool is in the session, above the self-delegation note', async () => {
    const message = await buildSystemMessage({ preconfig, delegationAvailable: true, selfDelegationAvailable: true });

    expect(message).toContain('delegate_task hands a task to a Prokop child session');
    // Prokop has no native subagents; the shared paragraph says how to call the tools here.
    expect(message).not.toContain('Your native subagents');
    expect(message).toContain('in your tool list');
    expect(message.indexOf('delegate_task hands')).toBeLessThan(message.indexOf('SELF-DELEGATION:'));
  });
});
