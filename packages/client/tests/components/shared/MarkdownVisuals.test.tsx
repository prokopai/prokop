import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const theme = vi.hoisted(() => ({ resolvedMode: 'dark' as 'dark' | 'light' }));
const RAW_SVG = vi.hoisted(() => '<svg xmlns="http://www.w3.org/2000/svg"><style>.n{fill:url(https://evil.example/x)}</style>'
  + '<script>alert(1)</script><g class="n" onclick="alert(2)"><text>A to B</text></g></svg>');
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, code: string) => {
    if (code.includes('broken')) throw new Error('Parse error on line 2:\nmore detail');
    return { svg: RAW_SVG };
  }),
}));

vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({ resolvedMode: theme.resolvedMode }),
}));
vi.mock('mermaid', () => ({ default: mermaid }));

import { isClosedFence, MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { sanitizeMermaidSvg } from '@/components/shared/MermaidDiagram';

describe('MarkdownRenderer visuals', () => {
  beforeEach(() => {
    theme.resolvedMode = 'dark';
    mermaid.render.mockClear();
    mermaid.initialize.mockClear();
  });

  test('renders $$ math with KaTeX, inline and as a block', () => {
    const { container } = render(<MarkdownRenderer>{'Energy $$E = mc^2$$ here.\n\n$$\n\\int_0^1 x\\,dx\n$$'}</MarkdownRenderer>);
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  test('keeps dollar amounts as text', () => {
    const { container } = render(<MarkdownRenderer>{'It costs $5 and $10 later.'}</MarkdownRenderer>);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toContain('It costs $5 and $10 later.');
  });

  test('renders math in raw-HTML documents after sanitizing', () => {
    const { container } = render(<MarkdownRenderer allowHtml>{'<p align="center">x</p>\n\n$$a+b$$'}</MarkdownRenderer>);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  test('draws a closed mermaid block as a sanitized diagram', async () => {
    const { container } = render(<MarkdownRenderer>{'```mermaid\ngraph TD\n  A-->B\n```'}</MarkdownRenderer>);
    await waitFor(() => expect(container.querySelector('[role="img"]')).not.toBeNull());
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', theme: 'dark' }));
    // happy-dom's DOM cannot run DOMPurify faithfully; this checks the wiring only.
    // The sanitizer itself was checked against a real Mermaid SVG in Chromium.
    const html = container.querySelector('[role="img"]')!.innerHTML;
    expect(html).toBe(sanitizeMermaidSvg(RAW_SVG));
  });

  test('shows a streaming mermaid block as code until its fence closes', () => {
    render(<MarkdownRenderer>{'```mermaid\ngraph TD\n  A-->B'}</MarkdownRenderer>);
    expect(screen.getByText('mermaid')).toBeInTheDocument();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  test('a fence counts as closed only with its own closing line', () => {
    expect(isClosedFence('```mermaid\ngraph TD\n```')).toBe(true);
    expect(isClosedFence('~~~mermaid\ngraph TD\n~~~  \n')).toBe(true);
    expect(isClosedFence('```mermaid\ngraph TD')).toBe(false);
    expect(isClosedFence('```mermaid')).toBe(false);
  });

  test('draws diagrams in raw-HTML file previews too', async () => {
    const { container } = render(<MarkdownRenderer allowHtml>{'<p align="center">x</p>\n\n```mermaid\ngraph TD\n  A-->B\n```'}</MarkdownRenderer>);
    await waitFor(() => expect(container.querySelector('[role="img"]')).not.toBeNull());
  });

  test('falls back to the source with the first error line when a diagram cannot be drawn', async () => {
    render(<MarkdownRenderer>{'```mermaid\ngraph TD\n  broken\n```'}</MarkdownRenderer>);
    expect(await screen.findByText('Diagram not drawn: Parse error on line 2:')).toBeInTheDocument();
    expect(screen.getByText('mermaid')).toBeInTheDocument();
  });

  test('toggles between the diagram and its source', async () => {
    const user = userEvent.setup();
    const { container } = render(<MarkdownRenderer>{'```mermaid\ngraph LR\n  C-->D\n```'}</MarkdownRenderer>);
    await user.click(await screen.findByRole('button', { name: 'Show source' }));
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(screen.getByText('mermaid')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show diagram' }));
    expect(container.querySelector('[role="img"]')).not.toBeNull();
  });
});
