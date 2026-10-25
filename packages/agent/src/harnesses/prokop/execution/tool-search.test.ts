import { afterEach, describe, expect, test } from 'bun:test';
import type { Tool } from 'ai';
import { capabilityToolFromMcp } from '@prokopai/core/infrastructure/mcp/capability-tool';
import {
  activeToolNames,
  buildToolSearchTool,
  deferrableMcpTools,
  forgetToolSearch,
  loadedDeferredTools,
  searchDeferredTools,
  setDeferredTools,
  toolSearchDescription,
  TOOL_SEARCH_NAME,
  type DeferredToolEntry,
} from './tool-search';

/** A tool set like the one the MCP manager hands the harness: external tools keyed mcp_…, built-ins by bare name. */
function mcpTool(serverName: string, toolName: string, description: string): Tool {
  return capabilityToolFromMcp(
    { name: `mcp_${toolName}_0123456789abcdef`, serverName, toolName, description, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
    { call: async () => ({ content: [{ type: 'text', text: 'ok' }] }) },
  );
}

const toolSet: Record<string, Tool> = {
  mcp_browser_navigate_0123456789abcdef: mcpTool('playwright', 'browser_navigate', 'Navigate the page to a URL.\nSecond line.'),
  mcp_browser_click_0123456789abcdef: mcpTool('playwright', 'browser_click', 'Click an element on the page'),
  mcp_list_issues_0123456789abcdef: mcpTool('github', 'list_issues', 'List issues in a repository'),
  mcp_create_issue_0123456789abcdef: mcpTool('github', 'create_issue', 'Create an issue'),
  delegate_task: { description: 'Built-in delegation', inputSchema: { type: 'object' } } as unknown as Tool,
  'read-file': { description: 'Built-in', inputSchema: { type: 'object' } } as unknown as Tool,
};

afterEach(() => { forgetToolSearch('s1'); forgetToolSearch('s2'); });

describe('deferrable tools', () => {
  test('are the mcp_ keyed ones with their origin; built-ins and native tools are not', () => {
    const entries = deferrableMcpTools(toolSet);
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'mcp_browser_click_0123456789abcdef', 'mcp_browser_navigate_0123456789abcdef', 'mcp_create_issue_0123456789abcdef', 'mcp_list_issues_0123456789abcdef',
    ]);
    const navigate = entries.find((entry) => entry.toolName === 'browser_navigate')!;
    expect(navigate).toMatchObject({ serverName: 'playwright', description: 'Navigate the page to a URL.\nSecond line.' });
    expect(navigate.inputSchema).toEqual({ type: 'object', properties: { q: { type: 'string' } } });
  });
});

describe('searching', () => {
  const catalog: DeferredToolEntry[] = deferrableMcpTools(toolSet);

  test('select: names tools exactly by key or by the server tool name and reports the unknown ones', () => {
    const { matches, unknown } = searchDeferredTools('select:browser_click, mcp_list_issues_0123456789abcdef, nope', catalog);
    expect(matches.map((entry) => entry.toolName)).toEqual(['browser_click', 'list_issues']);
    expect(unknown).toEqual(['nope']);
  });

  test('keywords rank name hits above description hits and honor the limit', () => {
    expect(searchDeferredTools('issue', catalog).matches.map((entry) => entry.toolName)).toEqual(['create_issue', 'list_issues']);
    expect(searchDeferredTools('page', catalog).matches.map((entry) => entry.toolName)).toEqual(['browser_click', 'browser_navigate']);
    expect(searchDeferredTools('browser', catalog, 1).matches.map((entry) => entry.toolName)).toEqual(['browser_click']);
    expect(searchDeferredTools('   ', catalog).matches).toEqual([]);
    expect(searchDeferredTools('kubernetes', catalog).matches).toEqual([]);
  });

  test('the description lists every deferred tool with its server and the first line of its description, cut short', () => {
    const text = toolSearchDescription(catalog);
    expect(text).toContain('4 tools are deferred');
    expect(text).toContain('- mcp_browser_navigate_0123456789abcdef (playwright: browser_navigate): Navigate the page to a URL.');
    expect(text).not.toContain('Second line');
  });
});

describe('a session loading tools', () => {
  test('the provider sees everything but the deferred tools until tool_search loads them; sessions are separate', async () => {
    const catalog = deferrableMcpTools(toolSet);
    const names = Object.keys(toolSet);
    expect(activeToolNames('s1', names)).toBeUndefined();

    setDeferredTools('s1', catalog.map((entry) => entry.name));
    expect(activeToolNames('s1', names)).toEqual(['delegate_task', 'read-file']);

    const search = buildToolSearchTool('s1', catalog);
    const result = await search.execute!({ query: 'issue' }, { toolCallId: 'c1', messages: [] }) as { loaded: Array<{ name: string; input_schema: unknown }>; note: string };
    expect(result.loaded.map((entry) => entry.name)).toEqual(['mcp_create_issue_0123456789abcdef', 'mcp_list_issues_0123456789abcdef']);
    expect(result.loaded[0]!.input_schema).toEqual({ type: 'object', properties: { q: { type: 'string' } } });
    expect(result.note).toContain('2 tools loaded');
    expect(activeToolNames('s1', [...names, TOOL_SEARCH_NAME])).toEqual(['mcp_list_issues_0123456789abcdef', 'mcp_create_issue_0123456789abcdef', 'delegate_task', 'read-file', TOOL_SEARCH_NAME]);
    expect(activeToolNames('s2', names)).toBeUndefined();

    // The next turn defers the same tools again; what was loaded stays loaded.
    setDeferredTools('s1', catalog.map((entry) => entry.name));
    expect(loadedDeferredTools('s1').sort()).toEqual(['mcp_create_issue_0123456789abcdef', 'mcp_list_issues_0123456789abcdef']);
    // A turn below the threshold ends deferral entirely.
    setDeferredTools('s1', []);
    expect(activeToolNames('s1', names)).toBeUndefined();
  });

  test('a search that finds nothing loads nothing and says so', async () => {
    const catalog = deferrableMcpTools(toolSet);
    setDeferredTools('s1', catalog.map((entry) => entry.name));
    const result = await buildToolSearchTool('s1', catalog).execute!({ query: 'select:ghost' }, { toolCallId: 'c2', messages: [] }) as { loaded: unknown[]; unknown: string[]; note: string };
    expect(result).toMatchObject({ loaded: [], unknown: ['ghost'] });
    expect(result.note).toContain('No deferred tool matched');
    expect(loadedDeferredTools('s1')).toEqual([]);
  });
});
