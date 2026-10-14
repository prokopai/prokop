import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoadedTool } from '@prokopai/sdk/tool';
import type { Preconfig } from '@prokopai/sdk/types';
import { createComposition, createProcessScope, enterAgentScope, facadeProcessPlugins } from '#tests/engine/helpers/standalone-composition';
import { createSingleModelConfiguration } from '@/infrastructure/providers/configuration/single-model';
import { createStandaloneHost } from '#tests/engine/helpers/standalone-host';
import { createInMemoryStorageBundle } from '@prokopai/core/infrastructure/storage/memory';
import { SandboxController } from '@prokopai/core/infrastructure/sandbox/controller';
import { SandboxProvider } from '@prokopai/core/infrastructure/sandbox/provider';
import type { AutoResponderRule, SandboxHistoryEntry } from '@prokopai/core/infrastructure/sandbox/types';
import { handleChat } from '@prokopai/agent/internal/harnesses/prokop/execution/chat-handler';
import { interruptManager } from '@prokopai/agent/internal/harnesses/prokop/execution/interrupt';
import type { RuntimeEvent } from '@prokopai/core/infrastructure/runtime/events';

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const preconfig: Preconfig = {
  id: 'test', name: 'test', description: '', systemPrompt: 'Finish the task.',
  tools: ['work'], model: 'test-model', provider: 'sandbox', settings: null, isDefault: true,
};
const text = (content: string): AutoResponderRule => ({ match: {}, response: { type: 'text', content }, maxUses: 1 });
const work = (): AutoResponderRule => ({ match: {}, response: { type: 'tool-call', toolName: 'work', args: {} }, maxUses: 1 });

interface Fixture {
  storage: ReturnType<typeof createInMemoryStorageBundle>;
  sessionId: string;
  history: SandboxHistoryEntry[];
  events: RuntimeEvent[];
}

/** Steer rows are marked by the host; this in-memory queue treats every row as one. */
async function fixture(rules: AutoResponderRule[], onTool: (fixture: Fixture) => Promise<void>,
  run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const storage = createInMemoryStorageBundle();
  storage.queue.peekSteer = sessionId => storage.queue.peek(sessionId);
  const sessionId = crypto.randomUUID();
  const history: SandboxHistoryEntry[] = [];
  const events: RuntimeEvent[] = [];
  const state: Fixture = { storage, sessionId, history, events };
  const controller = new SandboxController([...rules, text('unexpected extra model call')]);
  controller.setBroadcast(event => {
    if (event.type === 'sandbox.history') history.splice(0, history.length, ...event.entries);
  });
  const tool: LoadedTool = {
    definition: { name: 'work', description: 'Perform one bounded action.', inputSchema: { type: 'object', properties: {} }, timeout: 1000 },
    execute: async () => { await onTool(state); return { success: true, result: 'worked' }; },
    path: 'builtin:test',
  };
  const tempRoot = await mkdtemp(join(tmpdir(), 'prokop-steering-'));
  tempRoots.push(tempRoot);
  const host = createStandaloneHost({ workspace: process.cwd(), sandboxActive: true, tempRoot });
  host.delivery.emit = delivery => { events.push(delivery.event); };
  host.titles.isDefaultSessionTitle = () => false;
  const processScope = await createProcessScope([...facadeProcessPlugins()]);
  const { agentScope } = await createComposition(processScope, {
    storage, configuration: createSingleModelConfiguration({ modelId: 'test-model', providerId: 'sandbox' }),
    host, sandboxController: controller,
    providerOverrides: new Map([['sandbox', new SandboxProvider()]]),
    loadedTools: [tool], workspaceToolDiscovery: {},
    contextSources: { preconfigs: {
      get: async () => preconfig, getDefault: async () => preconfig,
      getForAgent: async () => preconfig, list: async () => [preconfig], listSubagents: async () => [],
    } },
  });
  try {
    await enterAgentScope(agentScope, async () => {
      await storage.conversation.createSession({
        id: sessionId, workspaceId: 'test', preconfigId: 'test', title: 'Test', status: 'active',
        parentId: null, agentName: null, metadata: null, selectedModel: 'test-model', selectedProvider: 'sandbox',
      });
      await run(state);
    });
  } finally {
    await agentScope.dispose();
    await processScope.dispose();
  }
}

function transcript(messages: Awaited<ReturnType<Fixture['storage']['conversation']['listMessagesWithParts']>>): string[] {
  return messages.map(entry => `${entry.message.role}:${entry.parts.map(part =>
    part.type === 'text' ? part.text : part.type).join('|')}`);
}

describe('prokop steering', () => {
  test('a steer message enters the running turn after the settled tool step', async () => {
    let steered = '';
    await fixture([work(), text('Done with tabs.')], async ({ storage, sessionId }) => {
      steered = (await storage.queue.addMessage(sessionId, 'Use tabs instead')).id;
    }, async ({ storage, sessionId, history, events }) => {
      await handleChat({ emit: delivery => events.push(delivery.event), attachOriginToSession: () => {} },
        'test', sessionId, 'Original objective');
      const messages = await storage.conversation.listMessagesWithParts(sessionId);
      expect(transcript(messages)).toEqual([
        'user:Original objective', 'assistant:step|tool', 'user:Use tabs instead', 'assistant:step|Done with tabs.',
      ]);
      expect(history).toHaveLength(2);
      const last = history[1]!.context.messages.at(-1);
      expect(last?.role).toBe('user');
      expect(JSON.stringify(last?.content)).toContain('Use tabs instead');
      expect(events).toContainEqual({ kind: 'queue', action: 'sending', sessionId, queueId: steered });
      expect(events.filter(event => event.kind === 'terminal' && event.sessionId === sessionId)).toHaveLength(1);
      expect(events.filter(event => event.kind === 'failure')).toEqual([]);
      expect(await storage.queue.peek(sessionId)).toBeNull();
      expect(interruptManager.isSessionActive(sessionId)).toBe(false);
    });
  });

  test('a row removed before delivery resumes the task without a user message', async () => {
    let stale: Awaited<ReturnType<Fixture['storage']['queue']['peek']>> = null;
    await fixture([work(), text('Done.')], async ({ storage, sessionId }) => {
      stale = await storage.queue.addMessage(sessionId, 'Never mind');
      await storage.queue.delete(stale.id);
      // The step boundary saw the row; the user removed it before the runtime claimed it.
      storage.queue.peekSteer = async () => {
        const row = stale;
        stale = null;
        return row;
      };
    }, async ({ storage, sessionId, history, events }) => {
      await handleChat({ emit: delivery => events.push(delivery.event), attachOriginToSession: () => {} },
        'test', sessionId, 'Original objective');
      expect(transcript(await storage.conversation.listMessagesWithParts(sessionId))).toEqual([
        'user:Original objective', 'assistant:step|tool', 'assistant:step|Done.',
      ]);
      expect(JSON.stringify(history[1]!.context.messages.at(-1)?.content)).toContain('Continue the existing task');
      expect(events.filter(event => event.kind === 'queue')).toEqual([]);
      expect(events.filter(event => event.kind === 'terminal' && event.sessionId === sessionId)).toHaveLength(1);
    });
  });
});
