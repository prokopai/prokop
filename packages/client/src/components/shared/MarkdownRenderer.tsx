import { memo, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import 'katex/dist/katex.min.css';
import type { Components, ExtraProps, Options } from 'react-markdown';
import { Highlight, themes } from 'prism-react-renderer';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { localFileLinkPath } from '@/lib/fileLinks';
import { useTheme } from '@/components/providers/ThemeProvider';
import { MermaidDiagram } from './MermaidDiagram';
import { MarkdownFileLinkContext } from './markdownFileLinks';
import { rehypeStreamReveal } from './markdownStreamReveal';

type CodeTheme = typeof themes.oneDark;

/** Token colors from the theme, background from the app surface, so code sits in the palette. */
function onAppSurface(theme: CodeTheme): CodeTheme {
  return { ...theme, plain: { ...theme.plain, backgroundColor: 'transparent' } };
}

const CODE_THEME_DARK = onAppSurface(themes.oneDark);
const CODE_THEME_LIGHT = onAppSurface(themes.oneLight);

const COPY_RESET_DELAY_MS = 2000;

export function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  return '';
}

interface MarkdownCodeBlockProps {
  code: string;
  language: string;
  theme: CodeTheme;
  /** The closing fence has not arrived: the block is still growing. */
  streaming?: boolean;
}

/**
 * Lines per independently highlighted chunk while a fence is still open.
 * Finished chunks keep the same text, so they never re-tokenize or touch the
 * DOM again; each flush re-highlights only the last chunk.
 */
const STREAMING_CHUNK_LINES = 40;

export function splitStreamingCodeChunks(code: string): string[] {
  const lines = code.split('\n');
  const chunks: string[] = [];
  for (let start = 0; start < lines.length; start += STREAMING_CHUNK_LINES) {
    chunks.push(lines.slice(start, start + STREAMING_CHUNK_LINES).join('\n'));
  }
  return chunks;
}

const HighlightedLines = memo(function HighlightedLines({ code, language, theme }: { code: string; language: string; theme: CodeTheme }) {
  return (
    <Highlight theme={theme} code={code} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </>
      )}
    </Highlight>
  );
});

const MarkdownCodeBlock = memo(function MarkdownCodeBlock({ code, language, theme, streaming = false }: MarkdownCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), COPY_RESET_DELAY_MS);
    } catch {
      // clipboard unavailable (permissions, non-secure context); keep state unchanged
    }
  }, [code]);

  // No header bar: the block is one quiet surface. Language and copy sit in
  // the corner and show on hover (always on touch).
  return (
    <div className="group/code relative my-2 w-full min-w-0 max-w-full rounded-lg bg-(--code-block-bg)">
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded-md bg-card/90 px-1 opacity-0 transition-opacity group-hover/code:opacity-100 group-focus-within/code:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100">
        <span className="select-none pl-1 font-mono text-2xs text-muted-foreground/70">
          {language || 'text'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'flex items-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground',
            copied && 'text-foreground',
          )}
          title="Copy code"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg">
        {streaming ? (
          // Chunk boundaries can split a multi-line token (a long comment or
          // string) for as long as the block streams; the closed block below
          // highlights as one piece.
          <pre className={cn('m-0 rounded-none p-3 text-sm', `prism-code language-${language || 'text'}`)} style={theme.plain}>
            {splitStreamingCodeChunks(code).map((chunk, index) => (
              <HighlightedLines key={index} code={chunk} language={language || 'text'} theme={theme} />
            ))}
          </pre>
        ) : (
          <Highlight theme={theme} code={code} language={language || 'text'}>
            {({ className: hlClassName, style, tokens, getLineProps, getTokenProps }) => (
              <pre className={cn('m-0 rounded-none p-3 text-sm', hlClassName)} style={style}>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        )}
      </div>
    </div>
  );
});

type HastElement = NonNullable<ExtraProps['node']>;

const ALIGN_CLASSES: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

/** Raw HTML `align` (README-style `<p align="center">`) as a text-align class. */
function alignClass(node: HastElement | undefined): string | undefined {
  const align = node?.properties.align;
  return typeof align === 'string' ? ALIGN_CLASSES[align.toLowerCase()] : undefined;
}

function firstSrcsetUrl(srcSet: unknown): string | undefined {
  const value = Array.isArray(srcSet) ? srcSet.join(',') : typeof srcSet === 'string' ? srcSet : '';
  return value.split(',')[0]?.trim().split(/\s+/)[0] || undefined;
}

/**
 * GitHub-style READMEs swap screenshots with
 * `<source media="(prefers-color-scheme: dark)">`. That media query follows
 * the OS, so pick the source for the app's theme and render a single image.
 */
function pictureImageProps(node: HastElement | undefined, mode: 'dark' | 'light'): ComponentProps<'img'> | null {
  const elements = (node?.children ?? []).filter((child): child is HastElement => child.type === 'element');
  const img = elements.find((child) => child.tagName === 'img');
  const themed = elements.find((child) => {
    if (child.tagName !== 'source') return false;
    const media = child.properties.media;
    return typeof media === 'string' && new RegExp(`prefers-color-scheme:\\s*${mode}`).test(media);
  });
  const src = (themed && firstSrcsetUrl(themed.properties.srcSet)) ?? img?.properties.src;
  if (typeof src !== 'string') return null;
  const props = img?.properties ?? {};
  return {
    src,
    alt: typeof props.alt === 'string' ? props.alt : undefined,
    title: typeof props.title === 'string' ? props.title : undefined,
    width: typeof props.width === 'string' || typeof props.width === 'number' ? props.width : undefined,
    height: typeof props.height === 'string' || typeof props.height === 'number' ? props.height : undefined,
  };
}

/** The renderer's link, for overrides that only special-case some links. */
export function MarkdownLink({ className, ...props }: ComponentProps<'a'>) {
  const openFile = useContext(MarkdownFileLinkContext);
  const filePath = openFile && props.href ? localFileLinkPath(props.href) : null;
  const linkClassName = cn('underline underline-offset-2 transition-colors text-foreground hover:text-foreground/80', className);
  if (openFile && filePath) {
    // A file path is not a URL on this origin: open it in the file preview.
    return (
      <a
        {...props}
        title={props.title ?? filePath}
        className={linkClassName}
        onClick={(event) => {
          event.preventDefault();
          openFile(filePath);
        }}
      />
    );
  }
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className={linkClassName}
      {...props}
    />
  );
}

function DefaultMarkdownImage({ node: _node, className, ...props }: ComponentProps<'img'> & ExtraProps) {
  // Inline like GitHub so badge rows and align="center" work; preflight makes images block.
  return <img {...props} className={cn('inline max-w-full', className)} />;
}

export interface MarkdownRendererProps {
  children: string;
  className?: string;
  /**
   * Render raw HTML in the markdown (README-style `<p align>`, `<picture>`,
   * `<img width>`), sanitized to GitHub's allowlist. Leave off for streamed
   * agent output, where partial tags would flicker.
   */
  allowHtml?: boolean;
  /** Replace individual element renderers, e.g. to sanitize links in untrusted content. */
  overrides?: Components;
  /**
   * Live streamed text: source offsets where each recent flush started, oldest
   * first. Words from those flushes fade in (see markdownStreamReveal).
   */
  revealBatches?: readonly number[];
}

type ComponentProps<T extends ElementType> = ComponentPropsWithoutRef<T>;

// Single-dollar math would turn "$5 and $10" into an equation, so math needs
// $$...$$ or a ```math block.
interface MarkdownNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
}

/** True once a fenced block's closing fence has arrived. */
export function isClosedFence(block: string): boolean {
  const lines = block.trimEnd().split('\n');
  return lines.length >= 2 && /^\s*(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]!);
}

/** Marks a fenced block still streaming, so a diagram is drawn only once it is complete. */
function remarkMarkOpenFences() {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: MarkdownNode) => {
      const { start, end } = { start: node.position?.start.offset, end: node.position?.end.offset };
      if (node.type === 'code' && start !== undefined && end !== undefined && !isClosedFence(source.slice(start, end))) {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataFenceOpen: true } };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

const REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkMarkOpenFences];
// KaTeX runs after the sanitizer so its own markup is kept; trust stays off.
const REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [[rehypeKatex, { throwOnError: false, strict: 'ignore' }]];
const HTML_REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [rehypeRaw, rehypeSanitize, ...REHYPE_PLUGINS];

export const MarkdownRenderer = memo(function MarkdownRenderer({ children, className, allowHtml = false, overrides, revealBatches }: MarkdownRendererProps) {
  const { resolvedMode } = useTheme();
  const codeTheme = resolvedMode === 'dark' ? CODE_THEME_DARK : CODE_THEME_LIGHT;

  const components: Components = useMemo(() => ({
    code({ node, className: codeClassName, children: codeChildren, ...props }) {
      const match = /language-(\w+)/.exec(codeClassName || '');
      const language = match ? match[1] : '';
      const codeString = extractText(codeChildren);
      const isBlock = Boolean(language) || codeString.includes('\n');

      if (isBlock) {
        const code = codeString.replace(/\n$/, '');
        const block = (
          <MarkdownCodeBlock
            code={code}
            language={language}
            theme={codeTheme}
            streaming={Boolean(node?.properties.dataFenceOpen)}
          />
        );
        if (language === 'mermaid' && !node?.properties.dataFenceOpen) {
          return <MermaidDiagram code={code} source={block} />;
        }
        return block;
      }

      return (
        <code className={cn('px-1.5 py-0.5 rounded-md text-sm font-mono bg-(--code-inline-bg)', codeClassName)} {...props}>
          {codeChildren}
        </code>
      );
    },
    a({ href, children, ...props }) {
      return <MarkdownLink href={href} {...props}>{children}</MarkdownLink>;
    },
    p({ node, children }: ComponentProps<'p'> & ExtraProps) {
      return <p className={cn('last:mb-0 leading-relaxed break-words', alignClass(node))}>{children}</p>;
    },
    ul({ children }: ComponentProps<'ul'>) {
      return <ul className="list-outside list-disc pl-8">{children}</ul>;
    },
    ol({ children }: ComponentProps<'ol'>) {
      return <ol className="list-outside list-decimal pl-8">{children}</ol>;
    },
    li({ children, className }: ComponentProps<'li'>) {
      const isNested = className?.includes('nested');
      return <li className={cn('leading-snug', isNested && 'ml-8')}>{children}</li>;
    },
    h1({ node, children }: ComponentProps<'h1'> & ExtraProps) {
      return <h1 className={cn('text-lg font-semibold mb-1.5 mt-3 first:mt-0', alignClass(node))}>{children}</h1>;
    },
    h2({ node, children }: ComponentProps<'h2'> & ExtraProps) {
      return <h2 className={cn('text-base font-semibold mb-1.5 mt-2.5 first:mt-0', alignClass(node))}>{children}</h2>;
    },
    h3({ node, children }: ComponentProps<'h3'> & ExtraProps) {
      return <h3 className={cn('text-sm font-semibold mb-1 mt-2 first:mt-0', alignClass(node))}>{children}</h3>;
    },
    img: DefaultMarkdownImage,
    picture({ node, children }: ComponentProps<'picture'> & ExtraProps) {
      const image = pictureImageProps(node, resolvedMode);
      if (!image) return <picture>{children}</picture>;
      const Img = (overrides?.img ?? DefaultMarkdownImage) as ElementType;
      return <Img {...image} />;
    },
    blockquote({ children }: ComponentProps<'blockquote'>) {
      return (
        <blockquote className="border-l-2 border-border/50 pl-3 my-1.5 text-muted-foreground">
          {children}
        </blockquote>
      );
    },
    strong({ children }: ComponentProps<'strong'>) {
      return <strong className="font-semibold">{children}</strong>;
    },
    em({ children }: ComponentProps<'em'>) {
      return <em className="italic">{children}</em>;
    },
    hr() {
      return <hr className="my-3 border-border" />;
    },
    table({ children }: ComponentProps<'table'>) {
      return (
        <div className="my-2 overflow-x-auto max-w-full">
          <table className="w-full border-collapse text-sm">
            {children}
          </table>
        </div>
      );
    },
    th({ children }: ComponentProps<'th'>) {
      return (
        <th className="border bg-muted px-2 py-1.5 text-left font-semibold">
          {children}
        </th>
      );
    },
    td({ children }: ComponentProps<'td'>) {
      return (
        <td className="border px-2 py-1.5">
          {children}
        </td>
      );
    },
    ...overrides,
  }), [codeTheme, overrides, resolvedMode]);

  const basePlugins = allowHtml ? HTML_REHYPE_PLUGINS : REHYPE_PLUGINS;
  const rehypePlugins = useMemo<NonNullable<Options['rehypePlugins']>>(
    () => revealBatches === undefined ? basePlugins : [...basePlugins, [rehypeStreamReveal, { batchStarts: revealBatches }]],
    [basePlugins, revealBatches],
  );

  return (
    <div className={cn('w-full markdown-render overflow-x-auto break-words', className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
