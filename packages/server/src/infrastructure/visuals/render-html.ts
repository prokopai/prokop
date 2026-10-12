import { z } from 'zod';
import {
  HTML_RENDER_MAX_BYTES,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MAX_TITLE_LENGTH,
  HTML_RENDER_MIME_TYPE,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_READY_MESSAGE,
  HTML_RENDER_SIZE_MESSAGE,
  HTML_RENDER_THEME_MESSAGE,
  HTML_RENDER_TOOL_NAME,
  HTML_RENDER_THEME_VARIABLES,
  formatHtmlRenderMarker,
  type HtmlRenderReference,
} from '@prokopai/sdk';
import type { WorkspaceMcpResult } from '@/application/ports/mcp-tools';
import { createAttachment } from '@/infrastructure/sqlite/attachments';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';

const WHEN_TO_USE = 'Use it without being asked whenever a chart, table, diagram, timeline, comparison or mockup would explain the answer better than text, such as numbers across categories or over time. Short answers stay text.';

const description = [
  'Show a finished HTML page inline in this conversation, above your text reply: a chart, table, diagram, comparison, timeline or UI mockup.',
  WHEN_TO_USE,
  'Call it before writing the reply. The reader sees the page, so the reply adds only what the page does not say, without announcing or restating it.',
  'Write one self-contained document with inline <style> and <script>. Scripts from https CDNs, such as a chart library, load as written.',
  'The page runs sandboxed, with no cookies, storage or access to the app.',
  'Layout: the frame is as wide as the reply column (about 720px on desktop, 360px on phones) and sits on the conversation background.',
  'Leave html and body without a background. Use fluid widths with no outer padding, card, border or page title. Give charts fixed pixel heights.',
  'Never size html or body with 100vh or height:100%: the frame grows to fit the page.',
  `Theme: use these CSS variables, which follow the user's light or dark theme live: ${HTML_RENDER_THEME_VARIABLES.join(', ')}.`,
  'Use --chart-1 to --chart-5 for data series.',
].join(' ');

/**
 * Harness instructions while render_html is available. Claude Code may defer
 * MCP tools and Codex reaches them only through its MCP bridge, so neither
 * model sees the tool description until it looks.
 */
export function renderHtmlGuidance(call: string): string {
  return `You can show an HTML page inline in your reply with the render_html tool (${call}). ${WHEN_TO_USE} Read its tool description before the first call: it has the layout and theme rules.`;
}

const DEFAULT_HEIGHT = 480;

export const renderHtmlDefinition = {
  name: HTML_RENDER_TOOL_NAME,
  description,
  inputSchema: {
    type: 'object',
    // Short fields first: models write properties in this order, and a long
    // page must not crowd them out.
    properties: {
      title: { type: 'string', description: 'Short name for the page.' },
      height: { type: 'integer', description: `Expected page height in CSS pixels, ${HTML_RENDER_MIN_HEIGHT}-${HTML_RENDER_MAX_HEIGHT}. The frame starts at this height, then fits the page. Default ${DEFAULT_HEIGHT}.` },
      html: { type: 'string', description: 'A complete, self-contained HTML document.' },
    },
    required: ['html'],
    additionalProperties: false,
  } as Record<string, unknown>,
};

const inputSchema = z.object({
  html: z.string().min(1),
  title: z.string().trim().min(1).max(HTML_RENDER_MAX_TITLE_LENGTH).optional(),
  height: z.number().optional(),
}).strict();

/** A missing title falls back to the page's own <title>. */
function pageTitle(html: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim();
  return (title || 'Page').slice(0, HTML_RENDER_MAX_TITLE_LENGTH);
}

/** Input problems go back to the model as a tool error it can fix, never as a hidden exception. */
function inputError(text: string): WorkspaceMcpResult {
  return { content: [{ type: 'text', text }], isError: true };
}

// Applies the app theme the parent posts and reports the page height. Messages
// are accepted only from the embedding app, never from frames the page opens.
const bootstrapScript = `(() => {
  const root = document.documentElement;
  // The app passes its scheme in the fragment so the first paint already matches.
  root.style.colorScheme = /scheme=light/.test(location.hash) ? 'light' : 'dark';
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== ${JSON.stringify(HTML_RENDER_THEME_MESSAGE)}) return;
    if (data.vars && typeof data.vars === 'object') {
      for (const [name, value] of Object.entries(data.vars)) {
        if (/^--[a-z0-9-]+$/.test(name) && typeof value === 'string') root.style.setProperty(name, value);
      }
    }
    root.style.colorScheme = data.scheme === 'light' ? 'light' : 'dark';
  });
  let last = 0;
  const report = () => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    parent.postMessage({ type: ${JSON.stringify(HTML_RENDER_SIZE_MESSAGE)}, height }, '*');
  };
  new ResizeObserver(report).observe(root);
  addEventListener('load', report);
  parent.postMessage({ type: ${JSON.stringify(HTML_RENDER_READY_MESSAGE)} }, '*');
})();`;

const bootstrap = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<style>html{background:transparent;color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);'
  + 'scrollbar-width:none}html::-webkit-scrollbar{display:none}body{margin:0}</style>'
  + `<script>${bootstrapScript}</script>`;

/** Inserts the bootstrap at the start of the head, keeping a doctype first. */
export function injectRenderBootstrap(html: string): string {
  const anchor = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  if (!anchor) return bootstrap + html;
  const end = anchor.index + anchor[0].length;
  return html.slice(0, end) + bootstrap + html.slice(end);
}

function fileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${slug || 'page'}.html`;
}

/** Stores the page as a session attachment. The model gets one line back, never the HTML. */
export async function renderHtml(input: Record<string, unknown>, sessionId: string, workspacePath: string,
  signal?: AbortSignal, allowed?: () => Promise<boolean>): Promise<WorkspaceMcpResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return inputError(`Invalid render_html arguments: send html (a complete HTML document), and optionally title (up to ${HTML_RENDER_MAX_TITLE_LENGTH} characters) and height (a number), nothing else.`);
  }
  const { html } = parsed.data;
  const title = parsed.data.title ?? pageTitle(html);
  const size = Buffer.byteLength(html);
  if (size > HTML_RENDER_MAX_BYTES) {
    return inputError(`The page is ${size} bytes; the limit is ${HTML_RENDER_MAX_BYTES}. Move large data out or simplify the page.`);
  }
  const bytes = new TextEncoder().encode(injectRenderBootstrap(html));
  const height = Math.round(Math.min(HTML_RENDER_MAX_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, parsed.data.height ?? DEFAULT_HEIGHT)));
  const session = getSession(sessionId);
  if (!session || getWorkspace(session.workspaceId)?.path !== workspacePath) throw new Error('Render session unavailable');
  signal?.throwIfAborted();
  if (allowed && !await allowed()) throw new Error('Prokop Visuals is no longer available');
  signal?.throwIfAborted();
  const attachment = await createAttachment({ sessionId, workspaceId: session.workspaceId, filename: fileName(title),
    mimeType: HTML_RENDER_MIME_TYPE, sizeBytes: bytes.byteLength, data: bytes.buffer as ArrayBuffer });
  const htmlRender: HtmlRenderReference = { sessionId, attachmentId: attachment.id, accessKey: attachment.accessKey, title, height };
  return {
    // Text only: Claude Code hands structuredContent to the model in place of
    // the text, which would drop both the instruction and the marker.
    content: [{ type: 'text', text: `Rendered "${title}" inline in the conversation. The reader sees it; do not restate it.\n`
      + formatHtmlRenderMarker(htmlRender) }],
  };
}
