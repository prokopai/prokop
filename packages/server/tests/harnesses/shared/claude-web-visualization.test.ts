import { expect, test } from 'bun:test';
import { claudeToolVisualization } from '@/harnesses/shared/tool-viz';

test('Claude web search and fetch stay in raw data with a one-line status', () => {
  const results = 'Web search results for query: "x"\n\nLinks: [{"title":"a","url":"https://a.example"}]';
  expect(claudeToolVisualization('web-search', { query: 'top languages' }, results, false))
    .toEqual({ type: 'none', message: 'Searched: top languages' });
  expect(claudeToolVisualization('webfetch', { url: 'https://a.example' }, 'x'.repeat(2048), false))
    .toEqual({ type: 'none', badge: '2.0 KB', message: 'Fetched: https://a.example' });
});
