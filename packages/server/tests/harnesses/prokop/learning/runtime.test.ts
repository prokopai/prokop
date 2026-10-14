import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Preconfig } from '@prokopai/sdk';
import { installLearningReviewToolPort } from '@prokopai/core/application/ports/learning-review-tools';
import { buildAiSdkTools } from '@prokopai/agent/internal/harnesses/prokop/execution/build-tools';
import { createProkopHeadlessExecution } from '@prokopai/agent/internal/harnesses/prokop/execution';
import { createProkopLearningRuntime } from '@prokopai/agent/internal/harnesses/prokop/learning/index';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

let root: string | undefined;
afterEach(async () => {
  installLearningReviewToolPort(null);
  resetTestDatabase();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('prokop learning runtime', () => {
  test('declares the prokop identity and runs memory and skill logic on a given directory', async () => {
    root = await mkdtemp(join(tmpdir(), 'learning-runtime-'));
    const runtime = createProkopLearningRuntime();
    expect(runtime.harness).toBe('prokop');
    expect((await runtime.memory({ action: 'add', target: 'memory', content: 'Staged lesson' }, root)).success).toBe(true);
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toContain('Staged lesson');
    expect((await runtime.skills({ action: 'list' }, join(root, 'skills'))).success).toBe(true);
  });

  test('a headless run with a learning spec composes the review scope; its tools call the host port', async () => {
    setupTestDatabase();
    seedWorkspace({ id: 'ws', settings: { memory: { enabled: true, permissionRisk: 'high' } } });
    seedSession('ws', { id: 'review', metadata: { learningRunId: 'run' } });
    const calls: unknown[] = [];
    installLearningReviewToolPort({
      call: async (sessionId, name, input) => {
        calls.push([sessionId, name, input]);
        return { success: true, result: 'from host' };
      },
    });
    let toolNames: string[] = [];
    let scheduled = false;
    const run = createProkopHeadlessExecution({
      executeChildSession: async options => {
        if (!options.preconfig.tools) {
          scheduled = true;
          return { parts: [] };
        }
        const tools = await buildAiSdkTools({
          toolNames: options.preconfig.tools, sessionId: 'review', workspaceId: 'ws', workspacePath: '/test',
          modelId: 'test', providerId: 'test', canSpawnSubagents: false,
        });
        toolNames = Object.keys(tools).sort();
        await tools.memory!.execute!({ action: 'list', target: 'memory' },
          { toolCallId: 'call-1', messages: [], abortSignal: options.abortSignal ?? new AbortController().signal });
        return { parts: [] };
      },
    });
    const preconfig = { id: 'dev', name: 'Developer', model: 'test', provider: 'test', systemPrompt: 'Review' } as Preconfig;
    const input = { harness: 'prokop' as const, parentSessionId: 'review', childSessionId: 'review', preconfig,
      prompt: 'Review', workspacePath: '/test', workspaceId: 'ws', modelId: 'test', providerId: 'test', resumeFromHistory: false };

    expect(await run({ ...input, learning: { scope: 'workspace', improveSkills: false, home: false, systemPrompt: 'Scoped' } }))
      .toEqual({ parts: [] } as never);
    expect(toolNames).toEqual(['memory', 'session_search']);
    expect(calls).toEqual([['review', 'memory', { action: 'list', target: 'memory' }]]);

    // Without a spec it is an ordinary scheduled child run.
    await run(input);
    expect(scheduled).toBe(true);
  });
});
