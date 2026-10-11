import { render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const theme = vi.hoisted(() => ({ resolvedMode: 'dark' as 'dark' | 'light' }));

vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({ resolvedMode: theme.resolvedMode }),
}));

import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';

const README_HEADER = `<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.webp">
    <img src="docs/hero-light.webp" alt="Hero" width="900">
  </picture>
</p>

<h1 align="center">Title</h1>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT"></a>
</p>

Plain **markdown** still works.
`;

describe('MarkdownRenderer raw HTML', () => {
  beforeEach(() => {
    theme.resolvedMode = 'dark';
  });

  test('drops raw HTML unless allowHtml is set', () => {
    const { container } = render(<MarkdownRenderer>{README_HEADER}</MarkdownRenderer>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('markdown');
  });

  test('renders README-style HTML with alignment, badges and markdown together', () => {
    const { container } = render(<MarkdownRenderer allowHtml>{README_HEADER}</MarkdownRenderer>);
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Title');
    expect(heading?.className).toContain('text-center');
    const badge = container.querySelector('img[alt="License"]');
    expect(badge?.getAttribute('src')).toBe('https://img.shields.io/badge/license-MIT');
    expect(badge?.className).toContain('inline');
    expect(badge?.closest('p')?.className).toContain('text-center');
    expect(container.querySelector('strong')?.textContent).toBe('markdown');
  });

  test('picks the <picture> source for the app theme, not the OS', () => {
    const dark = render(<MarkdownRenderer allowHtml>{README_HEADER}</MarkdownRenderer>);
    const darkHero = dark.container.querySelector('img[alt="Hero"]');
    expect(darkHero?.getAttribute('src')).toBe('docs/hero-dark.webp');
    expect(darkHero?.getAttribute('width')).toBe('900');
    expect(dark.container.querySelector('source')).toBeNull();
    dark.unmount();

    theme.resolvedMode = 'light';
    const light = render(<MarkdownRenderer allowHtml>{README_HEADER}</MarkdownRenderer>);
    expect(light.container.querySelector('img[alt="Hero"]')?.getAttribute('src')).toBe('docs/hero-light.webp');
  });

  test('strips scripts, event handlers, inline styles and javascript: links', () => {
    const html = `<script>window.pwned = true</script>
<img src="x.png" alt="x" onerror="window.pwned = true">
<a href="javascript:alert(1)">bad</a>
<div style="position:fixed">styled</div>`;
    const { container } = render(<MarkdownRenderer allowHtml>{html}</MarkdownRenderer>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.textContent).toContain('styled');
  });
});
