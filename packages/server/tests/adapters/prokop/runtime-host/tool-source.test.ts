import { afterEach, describe, expect, test } from 'bun:test';
import { configureWorkspaceToolDiscovery, getWorkspaceToolDiscovery } from '@prokopai/core/infrastructure/tools/tool-source';
import * as adapter from '@/adapters/prokop/runtime-host/tool-source';
import { builtinTools } from '@prokopai/agent/internal/harnesses/prokop/tools/index';
import { getBuiltinToolsPort, installBuiltinToolsPort } from '@prokopai/core/application/ports/builtin-tools';
import { resetDomainToolFallbacksForTests } from '@prokopai/core/infrastructure/tools/domain-tool-source';
import { configureProkopRuntimeDefaults } from '@prokopai/agent/internal/harnesses/prokop/bindings/runtime-defaults';

describe('Čapek workspace tool discovery adapter', () => {
  afterEach(() => {
    configureWorkspaceToolDiscovery();
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
      // Only the binary and the domains supply tools: nothing comes from disk.
      expect(tools.every((tool) => tool.source === 'builtin' || tool.source === 'domain')).toBe(true);
      expect(await adapter.prokopToolCatalog.getTool('browser_navigate')).toBeNull();
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
      expect(await adapter.prokopToolCatalog.getTool('read-file')).toBeNull();
    } finally {
      installBuiltinToolsPort(previousPort);
    }
  });

  test('installs the module-level discovery', () => {
    adapter.configureProkopWorkspaceToolDiscovery();
    expect(getWorkspaceToolDiscovery()).toBe(adapter.prokopWorkspaceToolDiscovery);
  });
});
