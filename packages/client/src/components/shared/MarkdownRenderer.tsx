import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import type { Components, ExtraProps } from 'react-markdown';
import { Highlight, themes } from 'prism-react-renderer';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/providers/ThemeProvider';

const CODE_THEME_DARK = themes.oneDark;
const CODE_THEME_LIGHT = themes.oneLight;
const CODE_THEME_INVERTED_DARK = themes.nightOwl;
const CODE_THEME_INVERTED_LIGHT = themes.nightOwlLight;

const COPY_RESET_DELAY_MS = 2000;

function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  return '';
}

interface MarkdownCodeBlockProps {
  code: string;
  language: string;
  theme: typeof themes.oneDark;
  inverted?: boolean;
}

const MarkdownCodeBlock = memo(function MarkdownCodeBlock({ code, language, theme, inverted = false }: MarkdownCodeBlockProps) {
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

  return (
    <div className="w-full max-w-full my-2 min-w-0">
      <div className="flex items-center justify-between gap-2 rounded-t-lg bg-muted/50 px-3 py-1">
        <span className={cn('text-xs font-mono select-none', inverted ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
          {language || 'text'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'flex items-center gap-1 rounded p-1 text-muted-foreground transition-colors',
            copied ? 'text-success' : inverted ? 'hover:text-primary-foreground' : 'hover:text-foreground',
          )}
          title="Copy code"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <div className="overflow-x-auto rounded-b-lg" style={{ backgroundColor: theme.plain.backgroundColor }}>
        <Highlight theme={theme} code={code} language={language || 'text'}>
          {({ className: hlClassName, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={cn('rounded-none text-sm p-3 m-0', hlClassName)} style={style}>
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

function DefaultMarkdownImage({ node: _node, className, ...props }: ComponentProps<'img'> & ExtraProps) {
  // Inline like GitHub so badge rows and align="center" work; preflight makes images block.
  return <img {...props} className={cn('inline max-w-full', className)} />;
}

export interface MarkdownRendererProps {
  children: string;
  className?: string;
  inverted?: boolean;
  /**
   * Render raw HTML in the markdown (README-style `<p align>`, `<picture>`,
   * `<img width>`), sanitized to GitHub's allowlist. Leave off for streamed
   * agent output, where partial tags would flicker.
   */
  allowHtml?: boolean;
  /** Replace individual element renderers, e.g. to sanitize links in untrusted content. */
  overrides?: Components;
}

type ComponentProps<T extends ElementType> = ComponentPropsWithoutRef<T>;

const HTML_REHYPE_PLUGINS = [rehypeRaw, rehypeSanitize];

export const MarkdownRenderer = memo(function MarkdownRenderer({ children, className, inverted = false, allowHtml = false, overrides }: MarkdownRendererProps) {
  const { resolvedMode } = useTheme();
  const isDark = resolvedMode === 'dark';

  const codeTheme = inverted
    ? (isDark ? CODE_THEME_INVERTED_DARK : CODE_THEME_INVERTED_LIGHT)
    : (isDark ? CODE_THEME_DARK : CODE_THEME_LIGHT);

  const components: Components = useMemo(() => ({
    code({ className: codeClassName, children: codeChildren, ...props }) {
      const match = /language-(\w+)/.exec(codeClassName || '');
      const language = match ? match[1] : '';
      const codeString = extractText(codeChildren);
      const isBlock = Boolean(language) || codeString.includes('\n');

      if (isBlock) {
        return (
          <MarkdownCodeBlock
            code={codeString.replace(/\n$/, '')}
            language={language}
            theme={codeTheme}
            inverted={inverted}
          />
        );
      }

      return (
        <code className={cn('px-1.5 py-0.5 rounded text-sm font-mono', inverted ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted', codeClassName)} {...props}>
          {codeChildren}
        </code>
      );
    },
    a({ href, children, ...props }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('underline underline-offset-2 transition-colors', inverted ? 'text-primary-foreground hover:text-primary-foreground/85' : 'text-primary hover:text-primary/80')}
          {...props}
        >
          {children}
        </a>
      );
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
        <blockquote className={cn('border-l-2 pl-3 my-1.5 italic', inverted ? 'border-primary-foreground/40 text-primary-foreground' : 'border-foreground/20 text-foreground/70')}>
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
      return <hr className={cn('my-3', inverted ? 'border-primary-foreground/30' : 'border-border')} />;
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
        <th className={cn('border border-border px-2 py-1.5 text-left font-semibold', inverted ? 'bg-primary-foreground/10 text-primary-foreground' : 'bg-muted')}>
          {children}
        </th>
      );
    },
    td({ children }: ComponentProps<'td'>) {
      return (
        <td className={cn('border px-2 py-1.5', inverted ? 'border-primary-foreground/20' : 'border-border')}>
          {children}
        </td>
      );
    },
    ...overrides,
  }), [inverted, codeTheme, overrides, resolvedMode]);

  return (
    <div className={cn('w-full markdown-render overflow-x-auto break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={allowHtml ? HTML_REHYPE_PLUGINS : undefined}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
