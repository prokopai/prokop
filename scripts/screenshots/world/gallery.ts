/**
 * Stories only the website gallery stills need: a page the agent shows with
 * render_html and a Mermaid diagram in a reply. Played before every other
 * story, so they sit at the bottom of the sidebar and the hero session stays
 * on top. Clips never play them.
 */
import { repoPath as file, type Story } from './types';

export const CLICKS_PAGE_TITLE = 'Clicks per link, last 7 days';
export const CLICKS_READY = 'is the only campaign link in the top five';
export const REDIRECT_FLOW_READY = 'Nothing on this path reads';

const bars: Array<[string, number]> = [
  ['spring', 1284],
  ['docs', 862],
  ['summer', 541],
  ['launch', 317],
  ['jobs', 96],
];

const clicksPage = `<!doctype html><html><head><style>
body{margin:0;font-family:var(--font-sans);color:var(--foreground);font-size:13px}
.row{display:grid;grid-template-columns:64px 1fr 48px;align-items:center;gap:10px;margin:7px 0}
.slug{font-family:var(--font-mono);color:var(--muted-foreground)}
.track{height:18px;border-radius:4px;background:var(--muted)}
.bar{height:100%;border-radius:4px;background:var(--chart-1)}
.n{text-align:right;font-variant-numeric:tabular-nums}
.note{margin-top:10px;color:var(--muted-foreground);font-size:12px}
</style></head><body>
${bars.map(([slug, n]) => `<div class="row"><span class="slug">${slug}</span><div class="track"><div class="bar" style="width:${Math.round((n / bars[0]![1]) * 100)}%"></div></div><span class="n">${n.toLocaleString('en-US')}</span></div>`).join('')}
<div class="note">Redirects counted by store.recordClick, Oct 5 to Oct 11.</div>
</body></html>`;

/** The agent reads the store and shows its numbers as a page. */
export const weeklyClicks: Story = {
  title: 'Which links get the most clicks?',
  prompt: 'Which links got the most clicks this week? Show me.',
  steps: [
    {
      type: 'tool-call',
      text: 'Reading how clicks are stored.',
      toolName: 'read-file',
      args: { path: file('src/store.ts') },
      usage: { inputTokens: 11_820, outputTokens: 64 },
    },
    {
      type: 'tool-call',
      toolName: 'render_html',
      args: { title: CLICKS_PAGE_TITLE, height: 220, html: clicksPage },
      usage: { inputTokens: 12_640, outputTokens: 702 },
    },
    {
      type: 'text',
      content: '`spring` is the only campaign link in the top five, and it is 30 days old. Once expiry works, its traffic will move to 410s.',
      usage: { inputTokens: 13_410, outputTokens: 46 },
    },
  ],
};

/** A short explanation with a flowchart of the redirect path. */
export const redirectFlow: Story = {
  title: 'How does a redirect flow?',
  prompt: 'Walk me through what happens when someone opens a short link.',
  steps: [
    {
      type: 'multi-tool-call',
      text: 'Reading the server and the redirect handler.',
      calls: [
        { toolName: 'read-file', args: { path: file('src/server.ts') } },
        { toolName: 'read-file', args: { path: file('src/routes/redirect.ts') } },
      ],
      usage: { inputTokens: 12_110, outputTokens: 71 },
    },
    {
      type: 'text',
      content: [
        '```mermaid',
        'flowchart LR',
        '  A["GET /:slug"] --> B["server.fetch"]',
        '  B --> C{"store.get(slug)"}',
        '  C -- missing --> D["404 Link not found"]',
        '  C -- found --> E["store.recordClick"]',
        '  E --> F["302 to link.url"]',
        '```',
        '',
        `${REDIRECT_FLOW_READY} \`expiresAt\`, so an expired link still counts a click and redirects.`,
      ].join('\n'),
      usage: { inputTokens: 13_020, outputTokens: 164 },
    },
  ],
};
