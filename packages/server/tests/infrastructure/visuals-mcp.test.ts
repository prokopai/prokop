import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_VISUALS_MCP_NAME, HTML_RENDER_MAX_BYTES, HTML_RENDER_MIME_TYPE, parseHtmlRenderMarker } from '@prokopai/sdk';
import type { WorkspaceMcpResult } from '@/application/ports/mcp-tools';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { getAttachmentByKey } from '@/infrastructure/sqlite/attachments';
import { Paths } from '@/infrastructure/runtime/paths';
import { createMcpManager } from '@/infrastructure/mcp/manager';
import { loadMcpConfig } from '@/infrastructure/mcp/config';
import { injectRenderBootstrap } from '@/infrastructure/visuals/render-html';
import { getTools } from '@/infrastructure/mcp/converter';

let root: string;
let manager: ReturnType<typeof createMcpManager>;
const page = { html: '<!doctype html><html><head><title>t</title></head><body><p>Chart</p></body></html>', title: 'Q3 revenue', height: 320 };

function session(id: string, parentId: string | null = null): void {
  createSession({ id, workspaceId: 'ws', title: id, status: 'active', permissionMode: 'standard',
    preconfigId: null, metadata: null, parentId, agentName: null, harness: 'prokop' });
}
const referenceOf = (result: WorkspaceMcpResult) => parseHtmlRenderMarker(String(result.content[0]?.text ?? ''));
async function renderTool(sessionId = 'session') {
  return (await manager.getWorkspaceTools(root, sessionId)).find(tool => tool.name === 'render_html');
}

beforeEach(async () => {
  setupTestDatabase();
  root = await mkdtemp(join(tmpdir(), 'visuals-mcp-'));
  Paths.configure({ dataDir: join(root, 'global') });
  seedWorkspace({ id: 'ws', path: root });
  manager = createMcpManager();
  session('session');
});
afterEach(async () => {
  await manager.shutdownWorkspace(root); await manager.shutdownWorkspace(null);
  resetTestDatabase(); Paths.reset(); await rm(root, { recursive: true, force: true });
});

test('visuals are on without any MCP configuration and turn off only when saved off', async () => {
  expect(await loadMcpConfig(null)).toEqual({ servers: {} });
  expect((await manager.getAllServerStatus(null))[BUILTIN_VISUALS_MCP_NAME]).toEqual({
    config: { type: 'builtin', id: 'visuals' }, status: { status: 'connected' } });
  expect((await manager.getAllServerStatus(root))[BUILTIN_VISUALS_MCP_NAME]?.status).toEqual({ status: 'connected' });
  expect(await manager.getServerTools(null, BUILTIN_VISUALS_MCP_NAME))
    .toEqual([expect.objectContaining({ name: 'render_html', enabled: true })]);
  expect(await renderTool()).toBeDefined();

  await manager.disconnectServer(null, BUILTIN_VISUALS_MCP_NAME);
  expect((await loadMcpConfig(null)).servers[BUILTIN_VISUALS_MCP_NAME]).toEqual({ type: 'builtin', id: 'visuals', enabled: false });
  expect(await renderTool()).toBeUndefined();

  await manager.saveServer(null, BUILTIN_VISUALS_MCP_NAME, { type: 'builtin', id: 'visuals', enabled: true });
  await manager.setToolEnabled(null, BUILTIN_VISUALS_MCP_NAME, 'render_html', false);
  expect(await renderTool()).toBeUndefined();
});

test('a workspace can turn visuals off for itself only', async () => {
  await manager.saveServer(root, BUILTIN_VISUALS_MCP_NAME, { type: 'builtin', id: 'visuals', enabled: false });
  expect(await renderTool()).toBeUndefined();
  expect((await manager.getAllServerStatus(null))[BUILTIN_VISUALS_MCP_NAME]?.status).toEqual({ status: 'connected' });
});

test('the reserved name holds only the visuals built-in', async () => {
  await expect(manager.saveServer(null, 'other', { type: 'builtin', id: 'visuals' })).rejects.toThrow('reserved');
  await expect(manager.saveServer(null, BUILTIN_VISUALS_MCP_NAME, { type: 'builtin', id: 'browser' })).rejects.toThrow('reserved');
  await expect(manager.saveServer(null, BUILTIN_VISUALS_MCP_NAME, { type: 'remote', url: 'https://example.com/mcp' }))
    .rejects.toThrow('reserved');
});

test('subagent, learning, unknown and sessionless discovery never get render_html', async () => {
  session('child', 'session');
  expect(await renderTool('child')).toBeUndefined();
  createSession({ id: 'review', workspaceId: 'ws', title: 'review', status: 'active', permissionMode: 'standard',
    preconfigId: null, metadata: { learningRunId: 'run' }, parentId: null, agentName: null, harness: 'prokop' });
  expect(await renderTool('review')).toBeUndefined();
  expect(await renderTool('missing')).toBeUndefined();
  expect((await manager.getWorkspaceTools(root)).some(tool => tool.name === 'render_html')).toBe(false);
});

test('a render is stored as a sandboxed attachment and the model gets no HTML back', async () => {
  const result = await (await renderTool())!.execute(page);
  const reference = referenceOf(result)!;
  expect(result.structuredContent).toBeUndefined();
  expect(reference).toMatchObject({ sessionId: 'session', title: 'Q3 revenue', height: 320 });
  expect(JSON.stringify(result.content)).not.toContain('<p>');
  const attachment = getAttachmentByKey(reference.attachmentId, reference.accessKey)!;
  expect(attachment).toMatchObject({ sessionId: 'session', mimeType: HTML_RENDER_MIME_TYPE, filename: 'q3-revenue.html' });
  const stored = await readFile(attachment.absolutePath, 'utf8');
  expect(stored.startsWith('<!doctype html><html><head><meta charset="utf-8">')).toBe(true);
  expect(stored).toContain('<p>Chart</p>');
});

test('Prokop gets the page as the tool visualization, outside what the model reads', async () => {
  const tools = await getTools(root, 'session');
  const output = await (tools.render_html!.execute as (input: unknown, options: unknown) => Promise<Record<string, unknown>>)(page, {});
  expect(output._visualization).toMatchObject({ type: 'html-render', title: 'Q3 revenue',
    render: { sessionId: 'session', title: 'Q3 revenue', height: 320 } });
});

test('render input is validated, height is clamped and oversized pages are refused', async () => {
  const tool = (await renderTool())!;
  const failure = async (input: Record<string, unknown>) => {
    const result = await tool.execute(input);
    expect(result.isError).toBe(true);
    return String(result.content[0]?.text);
  };
  expect(await failure({ title: 'x', height: 300 })).toContain('Invalid render_html arguments: send html');
  expect(await failure({ ...page, extra: true })).toContain('Invalid render_html arguments');
  expect(await failure({ ...page, html: 'x'.repeat(HTML_RENDER_MAX_BYTES + 1) })).toContain('the limit is');
  // Only html is required: a page cut short of its title and height still shows.
  const bare = referenceOf(await tool.execute({ html: page.html }))!;
  expect(bare).toMatchObject({ title: 't', height: 480 });
  expect(referenceOf(await tool.execute({ html: '<p>x</p>' }))!.title).toBe('Page');
  const tall = await tool.execute({ ...page, height: 99_999 });
  expect(referenceOf(tall)!.height).toBe(2000);
});

test('a handle discovered before visuals were turned off cannot render', async () => {
  const tool = (await renderTool())!;
  await manager.disconnectServer(null, BUILTIN_VISUALS_MCP_NAME);
  await expect(tool.execute(page)).rejects.toThrow('no longer available');
});

test('the bootstrap goes into the head and never ahead of a doctype', () => {
  expect(injectRenderBootstrap('<!DOCTYPE html><p>x</p>')).toMatch(/^<!DOCTYPE html><meta charset="utf-8">/);
  expect(injectRenderBootstrap('<html lang="en"><body>x</body></html>')).toMatch(/^<html lang="en"><meta charset/);
  expect(injectRenderBootstrap('<p>x</p>')).toMatch(/^<meta charset="utf-8">.*<p>x<\/p>$/s);
  expect(injectRenderBootstrap('<head><title>t</title></head>')).toMatch(/^<head><meta charset/);
});
