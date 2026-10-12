import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { HtmlRenderReference } from '@prokopai/sdk';

const theme = vi.hoisted(() => ({ resolvedMode: 'dark' as 'dark' | 'light' }));

vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({ resolvedMode: theme.resolvedMode }),
}));

import { HtmlRenderFrame } from '@/components/visualizations/HtmlRenderFrame';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

const reference: HtmlRenderReference = { sessionId: 's 1', attachmentId: 'att_1', accessKey: 'key', title: 'Q3 revenue', height: 320 };

function mount(serverUrl: string | null = 'http://127.0.0.1:4096') {
  const result = render(
    <ServerClientProvider value={{ sdkClient: null, serverUrl, apiToken: null, connected: true }}>
      <HtmlRenderFrame render={reference} />
    </ServerClientProvider>,
  );
  const frame = result.container.querySelector('iframe')!;
  return { ...result, frame };
}

function fromFrame(frame: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
  });
}

// The frames point at a server that is not running; serve them an empty page.
(window as unknown as { happyDOM: { settings: { fetch: { interceptor: unknown } } } }).happyDOM.settings.fetch.interceptor = {
  beforeAsyncRequest: async () => new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }),
};

describe('HtmlRenderFrame', () => {
  beforeEach(() => {
    theme.resolvedMode = 'dark';
    document.documentElement.style.setProperty('--background', 'oklch(0.2 0 0)');
    document.documentElement.style.setProperty('--chart-1', 'oklch(0.6 0.2 30)');
  });

  test('loads the page sandboxed in an opaque origin at the agent height', () => {
    const { frame } = mount();
    const sandbox = frame.getAttribute('sandbox')!.split(' ');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(frame.getAttribute('src')).toBe(
      'http://127.0.0.1:4096/api/sessions/s%201/attachments/att_1/content?key=key#scheme=dark');
    expect(frame.title).toBe('Q3 revenue');
    expect(frame.style.height).toBe('320px');
    expect(frame.style.colorScheme).toBe('dark');
  });

  test('sends the theme when the page is ready and follows its reported height', () => {
    const { frame } = mount();
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    fromFrame(frame, { type: 'prokop-render:ready' });
    expect(post).toHaveBeenCalledWith({ type: 'prokop-render:theme', scheme: 'dark',
      vars: expect.objectContaining({ '--background': 'oklch(0.2 0 0)', '--chart-1': 'oklch(0.6 0.2 30)' }) }, '*');
    fromFrame(frame, { type: 'prokop-render:size', height: 512.4 });
    expect(frame.style.height).toBe('513px');
    fromFrame(frame, { type: 'prokop-render:size', height: 99_999 });
    expect(frame.style.height).toBe('2000px');
  });

  test('ignores messages from any window other than its own frame', () => {
    const { frame } = mount();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'prokop-render:size', height: 900 }, source: window }));
    });
    expect(frame.style.height).toBe('320px');
  });

  test('a theme switch reaches a page already showing, without reloading it', () => {
    const { frame, rerender } = mount();
    const src = frame.getAttribute('src');
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    theme.resolvedMode = 'light';
    rerender(
      <ServerClientProvider value={{ sdkClient: null, serverUrl: 'http://127.0.0.1:4096', apiToken: null, connected: true }}>
        <HtmlRenderFrame render={reference} />
      </ServerClientProvider>,
    );
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'prokop-render:theme', scheme: 'light' }), '*');
    expect(frame.getAttribute('src')).toBe(src);
  });
});
