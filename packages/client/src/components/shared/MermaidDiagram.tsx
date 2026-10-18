import { memo, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { Code2, ImageIcon } from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import { cn } from '@/lib/utils';

type Mermaid = typeof import('mermaid').default;
type RenderResult = { svg: string } | { error: string };

const MAX_CACHED = 64;
const REMOTE_CSS_URL = /url\(\s*(?!['"]?#)[^)]*\)/gi;

let mermaidModule: Promise<Mermaid> | null = null;
// Mermaid renders through one shared offscreen element, so renders run one at a time.
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
const cache = new Map<string, Promise<RenderResult>>();
let purifier: ReturnType<typeof DOMPurify> | null = null;

// Mermaid is about 1 MB, so it loads only once a diagram is shown.
function loadMermaid(): Promise<Mermaid> {
  mermaidModule ??= import('mermaid').then(module => module.default).catch((error: unknown) => {
    mermaidModule = null;
    throw error;
  });
  return mermaidModule;
}

// Diagrams come from agent output and PR text. On top of Mermaid's strict mode,
// drop anything that runs script or fetches remote content; local url(#id) stays.
export function sanitizeMermaidSvg(svg: string): string {
  if (!purifier) {
    purifier = DOMPurify(window);
    purifier.addHook('uponSanitizeElement', (node, data) => {
      if (data.tagName === 'style' && node.textContent) node.textContent = node.textContent.replace(REMOTE_CSS_URL, 'none');
    });
    purifier.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName === 'style') data.attrValue = data.attrValue.replace(REMOTE_CSS_URL, 'none');
    });
  }
  return purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
}

function renderDiagram(code: string, theme: 'dark' | 'default'): Promise<RenderResult> {
  const key = `${theme}\n${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const id = `mermaid-diagram-${nextId++}`;
  const run = queue.then(async (): Promise<RenderResult> => {
    const mermaid = await loadMermaid();
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit' });
    try {
      const { svg } = await mermaid.render(id, code);
      return { svg: sanitizeMermaidSvg(svg) };
    } finally {
      // A failed render can leave Mermaid's offscreen element behind.
      document.getElementById(`d${id}`)?.remove();
    }
  }).catch((error: unknown): RenderResult => ({
    error: error instanceof Error ? error.message.split('\n')[0]! : 'The diagram could not be drawn',
  }));
  queue = run;
  cache.set(key, run);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return run;
}

/**
 * A ```mermaid block drawn as a diagram. `source` is the plain code block,
 * shown on request and when the diagram cannot be drawn.
 */
export const MermaidDiagram = memo(function MermaidDiagram({ code, source }: { code: string; source: ReactNode }) {
  const { resolvedMode } = useTheme();
  const theme = resolvedMode === 'dark' ? 'dark' : 'default';
  const key = `${theme}\n${code}`;
  const [result, setResult] = useState<{ key: string; value: RenderResult } | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let live = true;
    void renderDiagram(code, theme).then(value => { if (live) setResult({ key, value }); });
    return () => { live = false; };
  }, [code, theme, key]);

  const current = result?.key === key ? result.value : null;
  if (current && 'error' in current) {
    return (
      <div>
        {source}
        <p className="text-xs text-muted-foreground">Diagram not drawn: {current.error}</p>
      </div>
    );
  }

  return (
    // Markdown wraps code blocks in <pre>; Mermaid measures labels in the body
    // font, so the diagram must not inherit the monospace or they get clipped.
    <div className="group/mermaid relative my-2 font-sans whitespace-normal">
      {showSource ? source : current ? (
        <div
          role="img"
          aria-label="Diagram"
          className="overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: current.svg }}
        />
      ) : <div className="h-24 animate-pulse rounded-lg bg-muted/40" aria-label="Drawing diagram" />}
      {current && (
        <button
          type="button"
          onClick={() => setShowSource(value => !value)}
          className={cn('absolute right-1 top-1 rounded-md p-1 text-muted-foreground transition-opacity hover:text-foreground',
            'opacity-0 transition-opacity group-hover/mermaid:opacity-100 group-focus-within/mermaid:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
            showSource && 'right-9')}
          title={showSource ? 'Show diagram' : 'Show source'}
          aria-label={showSource ? 'Show diagram' : 'Show source'}
        >
          {showSource ? <ImageIcon className="size-3.5" /> : <Code2 className="size-3.5" />}
        </button>
      )}
    </div>
  );
});
