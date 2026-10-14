/** When to reach for render_html; shared by the tool description and harness instructions. */
export const WHEN_TO_USE = 'Use it without being asked whenever a chart, table, diagram, timeline, comparison or mockup would explain the answer better than text, such as numbers across categories or over time. Short answers stay text.';

/**
 * Harness instructions while render_html is available. Claude Code may defer
 * MCP tools and Codex reaches them only through its MCP bridge, so neither
 * model sees the tool description until it looks.
 */
export function renderHtmlGuidance(call: string): string {
  return `You can show an HTML page inline in your reply with the render_html tool (${call}). ${WHEN_TO_USE} Read its tool description before the first call: it has the layout and theme rules.`;
}
