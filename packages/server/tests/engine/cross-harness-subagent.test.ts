/**
 * A subagent role pinned to Claude CLI or Codex CLI runs on that harness:
 * the child session is owned by it from creation, the run goes through the
 * host's harness dispatch visibly, the answer is read back from the child's
 * transcript, and the tool output keeps the Prokop format byte for byte.
 */

import { describe, expect, test } from 'bun:test';
import type { HeadlessRunOptions, HeadlessSessionRunInput } from '@prokopai/core/application/ports/headless-execution';
import type { MessageWithParts, Preconfig, Session, TextPart } from '@prokopai/sdk/types';
import {
  executeSubagentWithDeps,
  lastAssistantText,
  parseStructuredText,
  subagentHarness,
  type SubagentServiceDeps,
} from '@prokopai/agent/internal/harnesses/prokop/subagent/task-tool';

const REVIEWER: Preconfig = {
  id: 'reviewer',
  name: 'Reviewer',
  description: 'Reviews diffs on Codex',
  systemPrompt: 'Review carefully.',
  tools: null,
  model: 'gpt-5.5',
  provider: null,
  variant: 'high',
  settings: null,
  isDefault: false,
  mode: 'subagent',
  modelHarness: 'codex-cli',
};

const EXPLORER: Preconfig = { ...REVIEWER, id: 'explore', name: 'Explore', model: null, variant: null, modelHarness: null, description: 'Explores' };

function session(overrides: Partial<Session>): Session {
  return {
    id: 'root',
    workspaceId: 'ws-1',
    preconfigId: 'dev',
    title: 'Root',
    status: 'active',
    metadata: null,
    createdAt: '',
    updatedAt: '',
    parentId: null,
    agentName: null,
    harness: 'prokop',
    ...overrides,
  } as Session;
}

function transcript(sessionId: string, texts: string[]): MessageWithParts[] {
  return texts.map((text, index) => ({
    message: { id: `m-${index}`, sessionId, role: index % 2 === 0 ? 'user' : 'assistant', createdAt: index } as MessageWithParts['message'],
    parts: [{ id: `p-${index}`, messageId: `m-${index}`, createdAt: index, type: 'text', text } as TextPart],
  }));
}

function makeDeps(answer: (input: HeadlessSessionRunInput) => string[] | { error: string }) {
  const sessions = new Map<string, Session>([['root', session({ id: 'root' })]]);
  const transcripts = new Map<string, MessageWithParts[]>();
  const runs: Array<{ input: HeadlessSessionRunInput; options?: HeadlessRunOptions }> = [];
  const events: unknown[] = [];
  const deps: SubagentServiceDeps = {
    sessionAccess: {
      getSession: (id) => sessions.get(id) ?? null,
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
      getPreconfigOrAgent: async (id) => [REVIEWER, EXPLORER].find((preconfig) => preconfig.id === id) ?? null,
      listSubagentPreconfigs: async () => [REVIEWER, EXPLORER],
    },
    broadcasts: {
      event: (event) => events.push(event),
      sessionCreated: (created) => events.push({ created: created.id, harness: created.harness }),
      sessionUpdated: (updated) => events.push({ updated: updated.id, status: updated.subagentStatus }),
      toSession: () => {},
    },
    runOnHarness: async (input, options) => {
      runs.push({ input, options });
      const result = answer(input);
      if ('error' in result) return result;
      transcripts.set(input.childSessionId, [
        ...(transcripts.get(input.childSessionId) ?? []),
        ...transcript(input.childSessionId, [input.prompt, ...result]),
      ]);
      return {};
    },
    readTranscript: async (sessionId) => transcripts.get(sessionId) ?? [],
  };
  return { deps, sessions, runs, events, transcripts };
}

describe('cross-harness subagents', () => {
  test('a role pinned to Codex runs there and the parent gets the Prokop-shaped result', async () => {
    const { deps, sessions, runs, events } = makeDeps(() => ['Looks right, two nits.']);

    const result = await executeSubagentWithDeps({
      description: 'Review auth diff',
      prompt: 'Review the diff in src/auth',
      subagent_type: 'reviewer',
      sessionId: 'root',
      workspaceId: 'ws-1',
      workspacePath: '/repo',
    }, deps);

    expect(result.error).toBeUndefined();
    const child = sessions.get(result.task_id)!;
    expect(child).toMatchObject({
      harness: 'codex-cli',
      parentId: 'root',
      preconfigId: 'reviewer',
      agentName: 'reviewer',
      selectedModel: 'gpt-5.5',
      selectedProvider: null,
      selectedVariant: 'high',
      subagentStatus: 'completed',
      title: 'Review auth diff (@reviewer subagent)',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.input).toMatchObject({
      harness: 'codex-cli',
      parentSessionId: 'root',
      childSessionId: child.id,
      prompt: 'Review the diff in src/auth',
      workspacePath: '/repo',
      workspaceId: 'ws-1',
      modelId: 'gpt-5.5',
      resumeFromHistory: false,
    });
    expect(runs[0]!.options?.visible).toBe(true);
    expect(result.result).toBe([
      `task_id: ${child.id} (for resuming to continue this task if needed)`,
      '',
      '<task_result>',
      'Looks right, two nits.',
      '</task_result>',
      '',
    ].join('\n'));
    expect(events).toContainEqual({ created: child.id, harness: 'codex-cli' });
    expect(events).toContainEqual({ updated: child.id, status: 'completed' });
  });

  test('a Prokop role (no pin) runs through host dispatch on Prokop, like every other child', async () => {
    const { deps, runs, sessions } = makeDeps(() => ['prokop answer']);

    const result = await executeSubagentWithDeps({
      description: 'Explore',
      prompt: 'Map the repo',
      subagent_type: 'explore',
      sessionId: 'root',
      workspaceId: 'ws-1',
    }, deps);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.input).toMatchObject({ harness: 'prokop', childSessionId: result.task_id, prompt: 'Map the repo' });
    expect(runs[0]!.options).toMatchObject({ visible: true });
    // A Prokop child carries no harness column: Prokop is the default.
    expect(sessions.get(result.task_id)?.harness).toBeUndefined();
    expect(result.result).toContain('prokop answer');
    expect(subagentHarness(EXPLORER)).toBe('prokop');
  });

  test('resuming a cross-harness child keeps its harness and reads only the new answer', async () => {
    const { deps, sessions, runs, transcripts } = makeDeps(() => ['second answer']);
    sessions.set('child-codex', session({
      id: 'child-codex', parentId: 'root', preconfigId: 'reviewer', harness: 'codex-cli', agentName: 'reviewer',
    }));
    transcripts.set('child-codex', transcript('child-codex', ['earlier prompt', 'earlier answer']));

    const result = await executeSubagentWithDeps({
      description: 'Follow up',
      prompt: 'And the tests?',
      subagent_type: 'reviewer',
      task_id: 'child-codex',
      sessionId: 'root',
      workspaceId: 'ws-1',
    }, deps);

    expect(runs[0]!.input.resumeFromHistory).toBe(true);
    expect(result.result).toContain('<task_result>\nsecond answer\n</task_result>');

    sessions.set('child-prokop', session({ id: 'child-prokop', parentId: 'root', preconfigId: 'reviewer', harness: 'prokop' }));
    const mismatch = await executeSubagentWithDeps({
      description: 'Follow up',
      prompt: 'x',
      subagent_type: 'reviewer',
      task_id: 'child-prokop',
      sessionId: 'root',
    }, deps);
    expect(mismatch.error).toBe('Invalid task_id: the subagent runs on prokop, not codex-cli');
  });

  test('a run error surfaces as the task error with the child marked failed', async () => {
    const { deps, sessions } = makeDeps(() => ({ error: 'Codex CLI is not installed' }));

    const result = await executeSubagentWithDeps({
      description: 'Review',
      prompt: 'x',
      subagent_type: 'reviewer',
      sessionId: 'root',
    }, deps);

    expect(result.error).toBe('Codex CLI is not installed');
    expect(result.result).toBe('');
    expect(sessions.get(result.task_id)?.subagentStatus).toBe('error');
  });

  test('a structured result is parsed from the CLI answer, fenced or bare', async () => {
    const { deps } = makeDeps(() => ['Here you go:\n```json\n{"approved": false, "concerns": ["persist bucket"]}\n```']);

    const result = await executeSubagentWithDeps({
      description: 'Verdict',
      prompt: 'Approve?',
      subagent_type: 'reviewer',
      sessionId: 'root',
      outputSchema: { type: 'object', properties: { approved: { type: 'boolean' } } },
    }, deps);

    expect(result.structuredResult).toEqual({ approved: false, concerns: ['persist bucket'] });
    expect(result.result).toContain('<structured_result>');
    expect(result.error).toBeUndefined();

    expect(parseStructuredText('{"a":1}')).toEqual({ a: 1 });
    expect(parseStructuredText('not json')).toBeNull();
    expect(lastAssistantText(transcript('s', ['q', 'a1', 'q2', 'a2']))).toBe('a2');
  });

  test('without harness dispatch a pinned role is refused, not run in-process', async () => {
    const { deps, sessions } = makeDeps(() => ['x']);
    delete deps.runOnHarness;

    const result = await executeSubagentWithDeps({
      description: 'Review',
      prompt: 'x',
      subagent_type: 'reviewer',
      sessionId: 'root',
    }, deps);

    expect(result.error).toBe('Subagent roles on codex-cli are not available here');
    expect(sessions.get(result.task_id)?.subagentStatus).toBe('error');
  });
});
