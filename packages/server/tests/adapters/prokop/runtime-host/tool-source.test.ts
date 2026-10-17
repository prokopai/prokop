import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { getWorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';

const realBarrel = await import('@prokopai/core/infrastructure/tools/registry');
const realConfig = await import('@prokopai/core/config');
const realPaths = await import('@prokopai/core/infrastructure/runtime/paths');

const realConfigureToolsPath = realBarrel.configureToolsPath;
const { configureWorkspaceToolDiscovery: realConfigureWorkspaceToolDiscovery } = await import('@prokopai/core/infrastructure/tools/tool-source');

let resolvedToolsPath = '/resolved/tools';
let resolvedPathError: Error | null = null;
const configuredPaths: (string | undefined)[] = [];

// File-scoped module mocks. Every other export is the real implementation, so
// unrelated module consumers keep their original behavior.
mock.module('@prokopai/core/config', () => ({
  ...realConfig,
  resolveToolsPath: (): string => {
    if (resolvedPathError) throw resolvedPathError;
    return resolvedToolsPath;
  },
}));

mock.module('@prokopai/core/infrastructure/runtime/paths', () => ({
  ...realPaths,
  getToolsDir: (): string => '/tools-dir',
}));

mock.module('@prokopai/core/infrastructure/tools/registry', () => ({
  ...realBarrel,
  configureToolsPath: (path?: string): void => {
    configuredPaths.push(path);
  },
}));

const adapter = await import('@/adapters/prokop/runtime-host/tool-source');
const { builtinTools } = await import('@prokopai/agent/internal/harnesses/prokop/tools/index');
const { getBuiltinToolsPort, installBuiltinToolsPort } = await import('@prokopai/core/application/ports/builtin-tools');
const { resetDomainToolFallbacksForTests } = await import('@prokopai/core/infrastructure/tools/domain-tool-source');
const { configureProkopRuntimeDefaults } = await import('@prokopai/agent/internal/harnesses/prokop/bindings/runtime-defaults');

let savedToolsPathEnv: string | undefined;

describe('Čapek workspace tool discovery adapter', () => {
  beforeEach(() => {
    configuredPaths.length = 0;
    resolvedToolsPath = '/resolved/tools';
    resolvedPathError = null;
    savedToolsPathEnv = process.env.JEAN2_TOOLS_PATH;
  });

  afterEach(() => {
    if (savedToolsPathEnv === undefined) delete process.env.JEAN2_TOOLS_PATH;
    else process.env.JEAN2_TOOLS_PATH = savedToolsPathEnv;
    realConfigureToolsPath();
    realConfigureWorkspaceToolDiscovery();
  });

  test('defers MCP initialization until discovery can resolve the session workspace', async () => {
    expect(Object.keys(adapter.prokopWorkspaceToolDiscovery).sort()).toEqual(['discoverTools', 'initializeWorkspace'].sort());
    await expect(adapter.prokopWorkspaceToolDiscovery.initializeWorkspace!('/unavailable/worktree')).resolves.toBeUndefined();
  });

  test('lists the harness built-ins through the installed port', async () => {
    const previousPort = getBuiltinToolsPort();
    installBuiltinToolsPort({ tools: () => builtinTools });
    try {
      const tools = await adapter.prokopToolCatalog.listTools();
      const readFile = tools.find((tool) => tool.name === 'read-file');
      expect(readFile).toMatchObject({ source: 'builtin' });
      expect(await adapter.prokopToolCatalog.getTool('read-file')).toBeDefined();
      // The removed tools stay absent even with the port installed.
      expect(tools.some((tool) => tool.name === 'git-worktree')).toBe(false);
      expect(await adapter.prokopToolCatalog.getTool('git-worktree')).toBeNull();
    } finally {
      installBuiltinToolsPort(previousPort);
    }
  });

  test('lists exactly the feature tools a Prokop agent can use, not removed ones', async () => {
    resetDomainToolFallbacksForTests();
    configureProkopRuntimeDefaults();
    const tools = await adapter.prokopToolCatalog.listTools();
    expect(tools.filter((tool) => tool.source === 'domain').map((tool) => tool.name)).toEqual([
      'agent_memory', 'agent_skill_manage', 'memory', 'session_search', 'skill', 'skill_manage', 'task',
    ]);
  });

  test('without an installed port the catalog lists no built-in entries', async () => {
    const previousPort = getBuiltinToolsPort();
    installBuiltinToolsPort(null);
    try {
      const tools = await adapter.prokopToolCatalog.listTools();
      expect(tools.every((tool) => tool.source !== 'builtin')).toBe(true);
    } finally {
      installBuiltinToolsPort(previousPort);
    }
  });

  test('configures the resolved tools path first and installs the module-level discovery', () => {
    process.env.JEAN2_TOOLS_PATH = '/env-must-not-win';
    adapter.configureProkopWorkspaceToolDiscovery();

    expect(configuredPaths).toEqual(['/resolved/tools']);
    expect(getWorkspaceToolDiscovery()).toBe(adapter.prokopWorkspaceToolDiscovery);
  });

  test('falls back to the environment path when resolution throws', () => {
    resolvedPathError = new Error('resolution unavailable');
    process.env.JEAN2_TOOLS_PATH = '/env/tools';
    adapter.configureProkopWorkspaceToolDiscovery();

    expect(configuredPaths).toEqual(['/env/tools']);
  });

  test('falls back to the tools directory when resolution throws and the environment is unset', () => {
    resolvedPathError = new Error('resolution unavailable');
    delete process.env.JEAN2_TOOLS_PATH;
    adapter.configureProkopWorkspaceToolDiscovery();

    expect(configuredPaths).toEqual(['/tools-dir']);
  });
});
