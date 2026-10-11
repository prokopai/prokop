import { useMemo } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import type { Components, ExtraProps } from 'react-markdown';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useFilePreviewQuery } from '@/hooks/queries/useFileQueries';
import { cn } from '@/lib/utils';

interface MarkdownFileContext {
  sdkClient: ProkopaiClient | null;
  workspaceId: string | undefined;
  /** Path of the markdown file, relative to `root` like the file tree uses. */
  path: string;
  root?: string;
}

/**
 * Resolve an image reference in a markdown file to a workspace path the
 * preview API accepts. `docs/a.png` and `../a.png` are relative to the
 * markdown file's folder; `/docs/a.png` is relative to the root, as on
 * GitHub. Returns null for URLs (they load directly) and for paths that
 * climb above the root.
 */
export function resolveMarkdownImagePath(markdownPath: string, src: string): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) return null;
  let relative: string;
  try {
    relative = decodeURI(src.replace(/[?#].*$/, ''));
  } catch {
    return null;
  }
  if (!relative) return null;

  const base = markdownPath.replace(/\\/g, '/');
  const absoluteBase = base.startsWith('/') && !relative.startsWith('/');
  const segments = relative.startsWith('/') ? [] : base.split('/').filter(Boolean).slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  if (segments.length === 0) return null;
  return (absoluteBase ? '/' : '') + segments.join('/');
}

type ImgProps = ComponentPropsWithoutRef<'img'> & ExtraProps;

function WorkspaceImage({ context, path, alt, className, node: _node, src: _src, ...props }: ImgProps & {
  context: MarkdownFileContext;
  path: string;
}) {
  const { data, isLoading } = useFilePreviewQuery(context.sdkClient, context.workspaceId, path, context.root);
  if (data?.kind === 'image') {
    return <img {...props} src={data.dataUrl} alt={alt} className={cn('inline max-w-full', className)} />;
  }
  if (isLoading) return null;
  // Missing, too large or not an image: show what it was meant to be.
  return <span className="text-muted-foreground italic" title={path}>{alt || path}</span>;
}

/**
 * Markdown overrides that load relative images from the workspace through
 * the file preview API. Images reach the client only as data URLs from that
 * API, so a plain `<img src="docs/a.png">` cannot load on its own.
 */
export function useMarkdownFileImages(context: MarkdownFileContext): Components {
  const { sdkClient, workspaceId, path, root } = context;
  return useMemo(() => {
    const ctx = { sdkClient, workspaceId, path, root };
    return {
      img({ node: _node, className, ...props }: ImgProps) {
        const resolved = typeof props.src === 'string' ? resolveMarkdownImagePath(path, props.src) : null;
        if (resolved) return <WorkspaceImage {...props} className={className} context={ctx} path={resolved} />;
        return <img {...props} className={cn('inline max-w-full', className)} />;
      },
    };
  }, [sdkClient, workspaceId, path, root]);
}
