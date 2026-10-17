import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient } from '@prokopai/sdk';

vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({ resolvedMode: 'light' }),
}));

import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { resolveMarkdownImagePath, useMarkdownFileImages } from '@/components/files/markdownFileImages';

describe('resolveMarkdownImagePath', () => {
  test('resolves against the markdown file folder', () => {
    expect(resolveMarkdownImagePath('README.md', 'docs/a.webp')).toBe('docs/a.webp');
    expect(resolveMarkdownImagePath('docs/guide/intro.md', './img/a.png')).toBe('docs/guide/img/a.png');
    expect(resolveMarkdownImagePath('docs/guide/intro.md', '../a.png')).toBe('docs/a.png');
  });

  test('treats a leading slash as the root, like GitHub', () => {
    expect(resolveMarkdownImagePath('docs/guide/intro.md', '/assets/a.png')).toBe('assets/a.png');
  });

  test('decodes the path and drops query and fragment', () => {
    expect(resolveMarkdownImagePath('README.md', 'docs/my%20shot.png?raw=1#x')).toBe('docs/my shot.png');
  });

  test('keeps absolute markdown paths absolute', () => {
    expect(resolveMarkdownImagePath('/tmp/notes/a.md', 'b.png')).toBe('/tmp/notes/b.png');
  });

  test('leaves URLs alone and refuses to climb above the root', () => {
    expect(resolveMarkdownImagePath('README.md', 'https://img.shields.io/x')).toBeNull();
    expect(resolveMarkdownImagePath('README.md', '//cdn.example.com/x.png')).toBeNull();
    expect(resolveMarkdownImagePath('README.md', 'data:image/png;base64,AAAA')).toBeNull();
    expect(resolveMarkdownImagePath('README.md', '../secret.png')).toBeNull();
  });
});

const preview = vi.fn();
const sdkClient = { http: { files: { preview } } } as unknown as ProkopaiClient;

function FilePreview({ content }: { content: string }) {
  const images = useMarkdownFileImages({ sdkClient, workspaceId: 'ws-1', path: 'docs/README.md', root: '/extra' });
  return <MarkdownRenderer allowHtml overrides={images}>{content}</MarkdownRenderer>;
}

function renderPreview(content: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FilePreview content={content} />
    </QueryClientProvider>,
  );
}

describe('useMarkdownFileImages', () => {
  beforeEach(() => {
    preview.mockReset();
  });

  test('loads relative images, including <picture> fallbacks, through the preview API', async () => {
    preview.mockResolvedValue({ kind: 'image', dataUrl: 'data:image/webp;base64,AAAA', size: 4 });
    renderPreview(`<picture>
  <source media="(prefers-color-scheme: dark)" srcset="shots/dark.webp">
  <img src="shots/light.webp" alt="Shot" width="900">
</picture>

![Badge](https://img.shields.io/badge/x)`);

    const shot = await screen.findByAltText('Shot');
    expect(shot.getAttribute('src')).toBe('data:image/webp;base64,AAAA');
    expect(shot.getAttribute('width')).toBe('900');
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith('ws-1', 'docs/shots/light.webp', { root: '/extra', anywhere: false });
    expect(screen.getByAltText('Badge').getAttribute('src')).toBe('https://img.shields.io/badge/x');
  });

  test('shows the alt text when the file is not a previewable image', async () => {
    preview.mockResolvedValue({ kind: 'too_large', size: 50_000_000 });
    renderPreview('![Big diagram](big.png)');
    await waitFor(() => expect(screen.getByText('Big diagram')).toBeTruthy());
    expect(screen.queryByRole('img')).toBeNull();
  });
});
