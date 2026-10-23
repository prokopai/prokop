import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { tool, jsonSchema } from 'ai';
import { configureWorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';
import { configureAgentSource, configurePreconfigSource } from '@prokopai/agent/internal/harnesses/prokop/context/sources';
import { configureStorage } from '@prokopai/core/infrastructure/storage/runtime';
import type { StorageBundle } from '@prokopai/core/infrastructure/storage/contracts';
import { configureProkopBindings } from '@/adapters/prokop/runtime-host/bindings';
import { prokopCompatibilityBindings } from '@/adapters/prokop/runtime-host/bindings';
import { prokopStorageBundle } from '@/adapters/prokop/runtime-host/storage';
import { buildAiSdkTools, type BuildToolsOptions } from '@prokopai/agent/internal/harnesses/prokop/execution/build-tools';
import { withToolRegistryResolver, type ToolRegistryResolver } from '@prokopai/core/infrastructure/tools/registry';
import type { Preconfig, Session, Workspace } from '@prokopai/sdk';
import type { LoadedTool, ToolContext } from '@prokopai/sdk/tool';

interface BindingOverrides {
  sessions?: Record<string, Partial<Session>>;
  sessionNotFound?: boolean;
  subagentPreconfigs?: Preconfig[];
  mcpTools?: Record<string, import('ai').Tool>;
  workspace?: Workspace | null;
}

let fixtureDir: string | null = null;

function configureBindings(overrides: BindingOverrides = {}): void {
  const storage: StorageBundle = {
    ...prokopStorageBundle,
    conversation: {
      ...prokopStorageBundle.conversation,
      getSession: async (id) => {
        if (overrides.sessionNotFound) return null;
        const session = overrides.sessions?.[id];
        return session
          ? { id, parentId: null, metadata: null, ...session } as Session
          : { id, parentId: null, metadata: null } as Session;
      },
    },
    workspaces: {
      ...prokopStorageBundle.workspaces,
      get: async () => overrides.workspace ?? null,
    },
  };
  configureStorage(storage);
  configureProkopBindings();
  configurePreconfigSource({
    get: async () => null,
    getDefault: async () => null,
    getForAgent: async () => null,
    list: async () => overrides.subagentPreconfigs ?? [],
    listSubagents: async () => overrides.subagentPreconfigs ?? [],
  });
  configureAgentSource();
  configureWorkspaceToolDiscovery({
    discoverTools: async () => overrides.mcpTools ?? {},
  });
}

/** Tools the composed scope would contribute, resolved through the ambient
 * scoped resolver exactly as a composed agent resolves its catalog. */
const seeded = new Map<string, LoadedTool>();
const seededResolver: ToolRegistryResolver = {
  get: (name) => seeded.get(name) ?? null,
  list: () => [...seeded.values()],
};

function seedTool(
  name: string,
  options: { capabilities?: string[]; success?: boolean; inspectContext?: boolean } = {},
): void {
  seeded.set(name, {
    definition: {
      name,
      description: `Fixture ${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    } as LoadedTool['definition'],
    execute: async (_input: unknown, ctx: ToolContext) => {
      if (options.success === false) return { success: false, error: 'Tool crashed' };
      if (options.inspectContext) {
        return { success: true, result: {
          workspacePath: ctx.workspacePath, allowedPaths: ctx.allowedPaths, tempDir: ctx.fs.tempDir,
          additionalAllowed: ctx.isWithinWorkspace('/workspace/shared/file.txt'),
          siblingAllowed: ctx.isWithinWorkspace('/workspace/project-other/file.txt'),
        } };
      }
      return { success: true, result: 'fixture-result' };
    },
  });
}

/** Builds inside the seeded scope, like a composed agent run. */
function buildSeeded(options: BuildToolsOptions) {
  return withToolRegistryResolver(seededResolver, () => buildAiSdkTools(options));
}

function defaultOptions(overrides: Partial<BuildToolsOptions> = {}): BuildToolsOptions {
  return {
    toolNames: [],
    workspacePath: undefined,
    workspaceId: undefined,
    sessionId: 'sess-1',
    modelId: 'gpt-4o',
    providerId: 'openai',
    allowedSkills: null,
    broadcastFn: undefined,
    ...overrides,
  };
}

const workspace: Workspace = {
  id: 'ws-1',
  name: 'Workspace',
  path: '/workspace',
  isVirtual: false,
  additionalPaths: [],
  settings: {},
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

describe('build-tools binding integration', () => {
  beforeEach(() => configureBindings());

  afterEach(() => {
    seeded.clear();
    if (fixtureDir) {
      rmSync(fixtureDir, { recursive: true, force: true });
      fixtureDir = null;
    }
    configureStorage(prokopStorageBundle);
    configureProkopBindings();
  });

  test('exposes only intrinsic artifact retrieval when no sources are enabled', async () => {
    const tools = await buildAiSdkTools(defaultOptions());
    expect(Object.keys(tools)).toEqual(['retrieve-tool-output']);
  });

  test('keeps intrinsic artifact retrieval callable without preconfig migration', async () => {
    const tools = await buildAiSdkTools(defaultOptions());
    expect(await tools['retrieve-tool-output']!.execute!(
      { artifactId: 'not-a-uuid' },
      { toolCallId: 'call-retrieve', messages: [] },
    )).toEqual({ error: 'Tool output artifact not found' });
  });

  test('loads and executes a real package registry tool', async () => {
    seedTool('read-file');

    const tools = await buildSeeded(defaultOptions({ toolNames: ['read-file'] }));
    const result = await tools['read-file']!.execute!({}, { toolCallId: 'call-1', messages: [] });

    expect(tools).toHaveProperty('read-file');
    expect(result).toBe('fixture-result');
  });

  test('constructs external tool workspace capabilities through the adapter seam', async () => {
    seedTool('workspace-context', { inspectContext: true });

    const tools = await buildSeeded(defaultOptions({
      toolNames: ['workspace-context'],
      workspacePath: '/workspace/project',
      additionalPaths: ['/workspace/shared'],
      sessionId: 'session-context',
    }));
    const result = await tools['workspace-context']!.execute!({}, { toolCallId: 'call-context', messages: [] });

    expect(result).toEqual({
      workspacePath: '/workspace/project',
      allowedPaths: [prokopCompatibilityBindings.workspace.createToolWorkspaceHost({
        sessionId: 'session-context',
      }).allowedRoots?.[0]],
      tempDir: prokopCompatibilityBindings.workspace.createToolWorkspaceHost({
        sessionId: 'session-context',
      }).tempDir,
      additionalAllowed: true,
      siblingAllowed: false,
    });
  });

  test('returns the existing error object for failed tool execution', async () => {
    seedTool('write-file', { success: false });

    const tools = await buildSeeded(defaultOptions({ toolNames: ['write-file'] }));
    const result = await tools['write-file']!.execute!({}, { toolCallId: 'call-2', messages: [] });

    expect(result).toEqual({ error: 'Tool crashed' });
  });

  test('filters interactive tools using binding-provided session ancestry', async () => {
    seedTool('question', { capabilities: ['interactive-user-input'] });
    seedTool('read-file');
    configureBindings({
      sessions: {
        parent: { parentId: null },
        child: { parentId: 'parent' },
      },
    });

    const tools = await buildSeeded(defaultOptions({
      sessionId: 'child',
      toolNames: ['question', 'read-file'],
    }));

    expect(tools).not.toHaveProperty('question');
    expect(tools).toHaveProperty('read-file');
  });

  test('omits the scheduler tool from scheduled-run sessions', async () => {
    configureBindings({
      sessions: {
        scheduled: { metadata: { scheduledJobId: 'job-1' } },
      },
      workspace: {
        ...workspace,
        settings: { scheduling: { enabled: true, permissionRisk: 'medium' } },
      },
    });

    const tools = await buildAiSdkTools(defaultOptions({
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      sessionId: 'scheduled',
    }));

    expect(tools).not.toHaveProperty('scheduler');
  });

  test('merges package-owned skill and host MCP tools through explicit sources', async () => {
    fixtureDir ??= mkdtempSync(join(tmpdir(), 'capek-build-tools-'));
    const workspacePath = join(fixtureDir, 'workspace');
    const skillDir = join(workspacePath, '.agents', 'skills', 'skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: skill\ndescription: Fixture skill\n---\nskill body');
    const mcp = tool({
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => 'mcp',
    });
    configureBindings({
      workspace: { ...workspace, path: workspacePath },
      mcpTools: { 'mcp-tool': mcp },
    });

    const tools = await buildAiSdkTools(defaultOptions({
      workspaceId: workspace.id,
      workspacePath,
    }));

    expect(tools.skill).toBeDefined();
    expect(tools['mcp-tool']).toBeDefined();
    expect(tools['mcp-tool']).not.toBe(mcp);
    expect(await tools['mcp-tool']!.execute!({}, { toolCallId: 'call-mcp', messages: [] })).toBe('mcp');
  });
});
