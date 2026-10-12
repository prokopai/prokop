import { afterEach, beforeEach, expect, test } from 'bun:test';
import { formatHtmlRenderMarker, type HtmlRenderReference, type ServerMessage, type ToolPart } from '@prokopai/sdk';
import { CodexToolItems } from '@/harnesses/codex-cli/tool-items';
import { claudeToolName, claudeToolSummary, claudeToolVisualization } from '@/harnesses/shared/tool-viz';
import { mcpModelOutput } from '@/infrastructure/mcp/model-output';
import { createMessage, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { createTestAssistantMessage } from '#tests/factories';
import { seedWorkspace } from '#tests/seed';

const render: HtmlRenderReference = { sessionId: 's', attachmentId: 'att_1', accessKey: 'key', title: 'Q3 revenue', height: 320 };
const text = `Rendered "Q3 revenue" inline in the conversation. The reader sees it; do not restate it.\n${formatHtmlRenderMarker(render)}`;
const expected = { type: 'html-render' as const, title: 'Q3 revenue', render };

beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: 'agent', metadata: null, parentId: null, agentName: null, harness: 'codex-cli' });
});
afterEach(() => resetTestDatabase());

test('Claude names render_html like the other harnesses and reads the page from result blocks', () => {
  expect(claudeToolName('mcp__workspace__render_html')).toBe('render_html');
  expect(claudeToolName('mcp__workspace__browser_screenshot')).toBe('workspace: browser_screenshot');
  expect(claudeToolVisualization('render_html', {}, JSON.stringify([{ type: 'text', text }]), false)).toEqual(expected);
  expect(claudeToolVisualization('render_html', {}, text, false)).toEqual(expected);
  expect(claudeToolSummary('render_html', { title: 'Q3 revenue', html: '<p>x</p>' })).toBe('Q3 revenue');
  expect(claudeToolVisualization('render_html', {}, 'MCP tool failed or access was disabled', true))
    .toEqual({ type: 'none', message: 'MCP tool failed or access was disabled' });
});

test('Codex shows render_html through the MCP bridge and leaves other bridged tools generic', () => {
  const assistant = createMessage(createTestAssistantMessage('s'));
  const sent: ServerMessage[] = [];
  const items = new CodexToolItems('s', assistant.id, 'turn', {
    send: (_origin, message) => { sent.push(message); },
    broadcast: message => { sent.push(message); },
    broadcastToSession: (_id, message) => { sent.push(message); },
    sendToController: (_id, message) => { sent.push(message); },
    sendToAskTargets: (_id, _authority, message) => { sent.push(message); },
  });
  const complete = (id: string, tool: string) => items.completed({ id, type: 'dynamicToolCall', namespace: null,
    tool: 'mcp_call_tool', status: 'completed', arguments: { tool, arguments: { title: 'Q3 revenue', html: '<p>x</p>' } },
    // The bridge returns the whole MCP result as JSON text.
    contentItems: [{ type: 'inputText', text: JSON.stringify({ content: [{ type: 'text', text }] }) }] });
  complete('render', 'render_html');
  complete('other', 'mcp_lookup_1234');
  const parts = listMessagesWithParts('s')[0]!.parts.filter((part): part is ToolPart => part.type === 'tool');
  const viz = (id: string) => {
    const part = parts.find(part => part.callId === `codex-item:turn:${id}`);
    return part?.state.status === 'completed' ? (part.state.output as { _visualization: unknown })._visualization : null;
  };
  expect(viz('render')).toEqual(expected);
  expect(parts.find(part => part.callId === 'codex-item:turn:render'))
    .toMatchObject({ name: 'render_html', presentation: { summary: 'Q3 revenue' } });
  expect(viz('other')).toEqual({ type: 'none', message: 'Completed' });
});

test('Prokop model output never carries the render visualization', () => {
  const output = { content: [{ type: 'text', text }], _visualization: expected };
  const model = mcpModelOutput({ output } as never) as { type: string; value: string };
  expect(model.type).toBe('text');
  expect(model.value).not.toContain('html-render');
  expect(model.value).toContain('prokop-render');
});
