/**
 * Agent HTML renders: a page an agent shows inline in its reply. The page is
 * stored as a session attachment and runs in a sandboxed frame with an opaque
 * origin, so its scripts never reach the app's storage or API token.
 */

export const HTML_RENDER_TOOL_NAME = 'render_html';

/** Stored MIME type. Browsers ignore the profile parameter and render HTML. */
export const HTML_RENDER_MIME_TYPE = 'text/html;profile=prokop-render';

// Codex refuses MCP arguments over 256,000 characters; keep every harness at one limit.
export const HTML_RENDER_MAX_BYTES = 200_000;
export const HTML_RENDER_MAX_TITLE_LENGTH = 80;
export const HTML_RENDER_MIN_HEIGHT = 120;
export const HTML_RENDER_MAX_HEIGHT = 2000;

/** postMessage types between the app and a render frame. */
export const HTML_RENDER_THEME_MESSAGE = 'prokop-render:theme';
export const HTML_RENDER_SIZE_MESSAGE = 'prokop-render:size';
export const HTML_RENDER_READY_MESSAGE = 'prokop-render:ready';

/** App theme variables the frame receives, read from the app's computed style. */
export const HTML_RENDER_THEME_VARIABLES = [
  '--background', '--foreground', '--muted', '--muted-foreground', '--card', '--card-foreground',
  '--border', '--primary', '--primary-foreground', '--accent', '--accent-foreground',
  '--destructive', '--success', '--warning',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--radius', '--font-sans', '--font-mono',
] as const;

/** Carried in the tool result's structured content. */
export interface HtmlRenderReference {
  sessionId: string;
  attachmentId: string;
  accessKey: string;
  title: string;
  height: number;
}

const MARKER = 'prokop-render ';

/** A result line the harness adapters read back; Claude and Codex keep only result text. */
export function formatHtmlRenderMarker(reference: HtmlRenderReference): string {
  return MARKER + JSON.stringify(reference);
}

/**
 * Result text as each harness stores it: plain text (Prokop), a JSON array of
 * MCP blocks (Claude), or a JSON MCP result object (Codex's MCP bridge).
 */
export function htmlRenderResultText(output: string): string {
  try {
    const value: unknown = JSON.parse(output);
    const blocks = Array.isArray(value) ? value
      : value && typeof value === 'object' && Array.isArray((value as { content?: unknown }).content)
        ? (value as { content: unknown[] }).content : null;
    if (blocks) {
      return blocks.map(block => block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text : '').join('\n');
    }
  } catch { /* Plain text. */ }
  return output;
}

export function parseHtmlRenderMarker(output: string): HtmlRenderReference | null {
  for (const line of htmlRenderResultText(output).split('\n')) {
    if (!line.startsWith(MARKER)) continue;
    try {
      const value = JSON.parse(line.slice(MARKER.length)) as Record<string, unknown>;
      if (['sessionId', 'attachmentId', 'accessKey', 'title'].every(key => typeof value[key] === 'string')
        && typeof value.height === 'number' && Number.isFinite(value.height)) {
        return { sessionId: value.sessionId as string, attachmentId: value.attachmentId as string,
          accessKey: value.accessKey as string, title: value.title as string, height: value.height };
      }
    } catch { /* Not a marker. */ }
  }
  return null;
}

export function isHtmlRenderMimeType(mimeType: string): boolean {
  return mimeType.replace(/\s+/g, '').toLowerCase() === HTML_RENDER_MIME_TYPE;
}
