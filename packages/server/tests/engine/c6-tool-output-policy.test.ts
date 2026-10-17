import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Tool as AiTool } from 'ai';
import {
  applyToolOutputPolicy,
  createToolOutputService,
  isToolOutputArtifactReference,
  resetDefaultToolOutputServiceForTests,
  RETRIEVE_TOOL_OUTPUT_NAME,
  retrieveToolOutput,
  retrieveToolOutputStandardTool,
  TOOL_OUTPUT_PREVIEW_CHARS,
  TOOL_OUTPUT_THRESHOLD_CHARS,
  truncateToolResult,
  wrapToolsWithOutputPolicy,
  withToolOutputService,
  type ToolOutputArtifactReference,
  type ToolOutputPolicyContext,
  type ToolOutputPolicyOptions,
} from '@prokopai/agent/internal/harnesses/prokop/tool-output/policy';
import { configureStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { createInMemoryStorageBundle } from '@prokopai/core/infrastructure/storage/memory';
import type { StorageBundle } from '@prokopai/core/infrastructure/storage/contracts';
import { configureRuntimeConfiguration } from '@prokopai/core/infrastructure/providers/configuration/runtime';
import { createDefaultRuntimeConfiguration } from '@prokopai/core/infrastructure/providers/configuration/defaults';
import { configureRuntimeHost, type RuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { configureSessionSearchHost, type SessionSearchHost } from '@prokopai/agent/internal/harnesses/shared/session-search/host';

const temporaryDirectories: string[] = [];

function tempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
    titles: {
      isDefaultSessionTitle: () => true,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost: () => ({
        root: '/tmp',
        additionalRoots: undefined,
        allowedRoots: [],
        tempDir: '/tmp/capek-c6-tool-output-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function minimalSearchHost(): SessionSearchHost {
  return {
    getWorkspace: async () => null,
    getSession: async () => null,
    listWorkspaceSessions: async () => [],
    listAgentSessions: async () => [],
    countSessionMessages: async () => 0,
    searchMessages: async () => [],
    countMessagesBefore: async () => 0,
    countMessagesAfter: async () => 0,
    getLatestMessage: async () => null,
    getMessage: async () => null,
    listMessagesBefore: async () => [],
    listMessagesAfter: async () => [],
    getMessageSummary: async () => null,
  };
}


function context(overrides: Partial<ToolOutputPolicyContext> = {}): ToolOutputPolicyContext {
  return {
    sessionId: 'tool-output-session',
    toolCallId: 'call-1',
    toolName: 'fixture',
    ...overrides,
  };
}

function makeOptions(overrides: Partial<ToolOutputPolicyOptions> = {}): ToolOutputPolicyOptions {
  return {
    thresholdChars: TOOL_OUTPUT_THRESHOLD_CHARS,
    previewChars: TOOL_OUTPUT_PREVIEW_CHARS,
    retrievalToolName: RETRIEVE_TOOL_OUTPUT_NAME,
    truncationMaxChars: 50_000,
    truncationPreviewChars: 10_000,
    truncationTempDir: join(tmpdir(), 'capek'),
    ...overrides,
  };
}

beforeEach(() => {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration(createDefaultRuntimeConfiguration());
  configureRuntimeHost(minimalHost());
  configureSessionSearchHost(minimalSearchHost());
});

afterEach(() => {
  resetDefaultToolOutputServiceForTests();
});

describe('C6 tool-output policy contract', () => {

  test('passes below-threshold results through untouched', async () => {
    expect(await applyToolOutputPolicy('small', context())).toBe('small');
    const object = { value: 'small' };
    expect(await applyToolOutputPolicy(object, context())).toBe(object);
  });

  test('preserves the _visualization overlay below the threshold', async () => {
    const withVisualization = { value: 'small', _visualization: { type: 'diff' } };
    expect(await applyToolOutputPolicy(withVisualization, context())).toBe(withVisualization);
  });

  test('strings above the threshold become a text artifact envelope', async () => {
    const large = 'x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS + 1);
    const result = await applyToolOutputPolicy(large, context());
    expect(isToolOutputArtifactReference(result)).toBe(true);
    const reference = result as ToolOutputArtifactReference;
    expect(reference.format).toBe('text');
    expect(reference.totalChars).toBe(large.length);
    expect(reference.preview).toHaveLength(TOOL_OUTPUT_PREVIEW_CHARS);
    expect(reference.complete).toBe(false);
    expect(reference.message).toBe(
      `Exact output is available with ${RETRIEVE_TOOL_OUTPUT_NAME} using artifactId ${reference.artifactId}.`,
    );
    const page = await retrieveToolOutput('tool-output-session', { artifactId: reference.artifactId });
    expect(page?.format).toBe('text');
    expect(page?.totalChars).toBe(large.length);
    expect(page?.complete).toBe(false);
  });

  test('objects above the threshold become a json artifact envelope with the visualization stripped from persisted content', async () => {
    const large = {
      content: 'y'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS),
      _visualization: { type: 'chart', data: 'z'.repeat(60_000) },
    };
    const result = await applyToolOutputPolicy(large, context());
    expect(isToolOutputArtifactReference(result)).toBe(true);
    const reference = result as ToolOutputArtifactReference & { _visualization?: unknown };
    expect(reference.format).toBe('json');
    expect(reference.totalChars).toBe(
      JSON.stringify(large, (_key, value) => _key === '_visualization' ? undefined : value).length,
    );
    expect(reference._visualization).toEqual({ type: 'chart', data: 'z'.repeat(60_000) });

    const page = await retrieveToolOutput('tool-output-session', { artifactId: reference.artifactId });
    expect(page).not.toBeNull();
    expect(page!.content).not.toContain('_visualization');
    expect(page!.content).toContain('content');
  });

  test('serialization failures fail open with the exact bounded preview', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = await applyToolOutputPolicy(cyclic, context());
    expect(result).toEqual({
      type: 'tool-output-preview',
      preview: '[object Object]',
      totalChars: null,
      complete: false,
      message: 'Exact tool output was not persisted. Only this bounded preview is available.',
    });

    expect(await applyToolOutputPolicy(undefined, context())).toEqual({
      type: 'tool-output-preview',
      preview: 'undefined',
      totalChars: null,
      complete: false,
      message: 'Exact tool output was not persisted. Only this bounded preview is available.',
    });

    const bigintResult = await applyToolOutputPolicy(123n, context());
    expect(bigintResult).toMatchObject({ type: 'tool-output-preview', preview: '123' });

    expect(await applyToolOutputPolicy(Symbol('s'), context())).toMatchObject({
      type: 'tool-output-preview',
      preview: 'Symbol(s)',
    });
  });

  test('artifact persistence failures fail open with the content length', async () => {
    const bundle = createInMemoryStorageBundle();
    const failing: StorageBundle = {
      ...bundle,
      toolOutputArtifacts: {
        ...bundle.toolOutputArtifacts,
        create: () => {
          throw new Error('disk full');
        },
      },
    };
    configureStorage(failing);
    const large = 'x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS + 100);
    const result = await applyToolOutputPolicy(large, context());
    expect(result).toMatchObject({
      type: 'tool-output-preview',
      totalChars: large.length,
      complete: false,
      message: 'Exact tool output was not persisted. Only this bounded preview is available.',
    });
    expect((result as { preview: string }).preview).toHaveLength(TOOL_OUTPUT_PREVIEW_CHARS);
  });

  test('malformed, foreign, and unknown ids fail closed', async () => {
    const large = 'x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS + 1);
    const result = await applyToolOutputPolicy(large, context()) as ToolOutputArtifactReference;

    expect(await retrieveToolOutput('tool-output-session', { artifactId: 'not-a-uuid' })).toBeNull();
    expect(await retrieveToolOutput('tool-output-session', { artifactId: '00000000-0000-4000-8000-000000000000' })).toBeNull();
    expect(await retrieveToolOutput('other-session', { artifactId: result.artifactId })).toBeNull();

    // The retrieval tool reports the exact failure string.
    const outcome = retrieveToolOutputStandardTool.execute(
      { artifactId: result.artifactId },
      { sessionId: 'other-session' } as never,
    );
    expect(outcome).resolves.toEqual({ success: false, error: 'Tool output artifact not found' });
  });

  test('retrieval pages clamp offset and limit exactly', async () => {
    const large = 'a'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS + 5);
    const result = await applyToolOutputPolicy(large, context()) as ToolOutputArtifactReference;
    const page = (await retrieveToolOutput('tool-output-session', {
      artifactId: result.artifactId,
      offset: large.length - 5,
      limit: 20_000,
    }))!;
    expect(page.content).toBe('a'.repeat(5));
    expect(page.complete).toBe(true);
    expect(page.nextOffset).toBeNull();
  });

  test('custom frozen options change the envelope thresholds only', async () => {
    const service = createToolOutputService({
      id: 'custom',
      options: makeOptions({ thresholdChars: 10, previewChars: 5 }),
    });
    const result = await withToolOutputService(service, async () =>
      applyToolOutputPolicy('0123456789abc', context())) as ToolOutputArtifactReference;
    expect(isToolOutputArtifactReference(result)).toBe(true);
    expect(result.preview).toBe('01234');
  });

  test('wrapping excludes the retrieval tool, non-functions, and self-wraps', async () => {
    const calls: string[] = [];
    const plain = {
      execute: async () => {
        calls.push('plain');
        return { ok: true };
      },
    } as unknown as AiTool;
    const retrieval = {
      execute: async () => ({ ok: true }),
    } as unknown as AiTool;
    const noExecute = { description: 'no execute' } as AiTool;

    const wrapped = wrapToolsWithOutputPolicy({
      plain,
      [RETRIEVE_TOOL_OUTPUT_NAME]: retrieval,
      noExecute,
    }, { sessionId: 'tool-output-session' });

    expect(wrapped[RETRIEVE_TOOL_OUTPUT_NAME]).toBe(retrieval);
    expect(wrapped.noExecute).toBe(noExecute);
    expect(wrapped.plain).not.toBe(plain);

    await (wrapped.plain.execute as (...args: unknown[]) => unknown)({}, { toolCallId: 'call-x' });
    expect(calls).toEqual(['plain']);

    const reWrapped = wrapToolsWithOutputPolicy(wrapped, { sessionId: 'tool-output-session' });
    expect(reWrapped.plain).toBe(wrapped.plain);

    // Missing toolCallId passes the result through unchanged.
    const result = await (wrapped.plain.execute as (...args: unknown[]) => unknown)({}, {});
    expect(result).toEqual({ ok: true });
  });

  test('the legacy truncation passes small results through', () => {
    const result = truncateToolResult({ small: true }, 'session', 'tool', tempDir('c6-trunc-small'));
    expect(result).toEqual({ small: true });
  });

  test('the legacy truncation persists long strings with the exact note', () => {
    const dir = tempDir('c6-trunc-string');
    const large = 's'.repeat(60_000);
    const result = truncateToolResult(large, 'session', 'read-file', dir) as string;
    expect(result.startsWith('s'.repeat(10_000))).toBe(true);
    expect(result).toContain('[Result truncated: 60000 chars total. Full result persisted to');
    expect(result).toContain('Use read-file tool to read it.');
    const persisted = readFileSync(
      (result.match(/persisted to (.+)\. Use/) as RegExpMatchArray)[1],
      'utf-8',
    );
    expect(persisted).toBe(JSON.stringify(large));
  });

  test('the legacy truncation preserves the exact object metadata', () => {
    const dir = tempDir('c6-trunc-object');
    const large = { content: 'c'.repeat(60_000) };
    const result = truncateToolResult(large, 'session', 'read-file', dir) as Record<string, unknown>;
    expect(result._persisted).toBe(true);
    expect(typeof result._filePath).toBe('string');
    expect(result._originalSize).toBe(JSON.stringify(large).length);
    expect(String(result.content)).toContain('[Result truncated:');
    expect(String(result.content)).toContain('Use read-file tool to read it.');
    const filePath = result._filePath as string;
    expect(readFileSync(filePath, 'utf-8')).toBe(JSON.stringify(large));
  });

  test('the legacy truncation keeps its exact non-fail-open filesystem errors', () => {
    // A regular file occupying the output directory path makes mkdirSync
    // throw; the pre-C6 truncation propagates filesystem errors.
    const blocked = tempDir('c6-trunc-blocked');
    rmSync(blocked, { recursive: true, force: true });
    const { writeFileSync } = require('fs') as typeof import('node:fs');
    writeFileSync(blocked, 'file');
    expect(() => truncateToolResult('x'.repeat(60_000), 'session', 'tool', blocked))
      .toThrow();
  });
});

describe('C6 scoped tool-output policy composition', () => {
});
