import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_READY_MESSAGE,
  HTML_RENDER_SIZE_MESSAGE,
  HTML_RENDER_THEME_MESSAGE,
  HTML_RENDER_THEME_VARIABLES,
  type HtmlRenderReference,
} from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/providers/ThemeProvider';
import { useSdkClient, useServerUrl } from '@/contexts/ServerClientContext';
import { buildApiUrl } from '@/config/urls';
import { cn } from '@/lib/utils';

const clampHeight = (height: number) => Math.min(HTML_RENDER_MAX_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, Math.ceil(height)));

function themeVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of HTML_RENDER_THEME_VARIABLES) {
    const value = style.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return vars;
}

/**
 * An agent's HTML page inline in the conversation. The frame has no
 * allow-same-origin, so the page runs in an opaque origin and cannot reach the
 * app's storage or API token. It gets the app theme by message and reports its
 * height back; the agent's estimate holds the space until then.
 */
export const HtmlRenderFrame = memo(function HtmlRenderFrame({ render }: { render: HtmlRenderReference }) {
  const sdkClient = useSdkClient();
  const serverUrl = useServerUrl();
  const { resolvedMode } = useTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(() => clampHeight(render.height));
  // Fixed at mount: later theme changes go by message, never by reloading the page.
  const [initialScheme] = useState(resolvedMode);
  const path = sdkClient?.http.attachments.getUrl(render.sessionId, render.attachmentId, render.accessKey)
    ?? `/api/sessions/${encodeURIComponent(render.sessionId)}/attachments/${encodeURIComponent(render.attachmentId)}/content?key=${encodeURIComponent(render.accessKey)}`;
  const src = `${serverUrl ? buildApiUrl(serverUrl, path) : path}#scheme=${initialScheme}`;

  const postTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: HTML_RENDER_THEME_MESSAGE, scheme: resolvedMode, vars: themeVariables() }, '*');
  }, [resolvedMode]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type === HTML_RENDER_READY_MESSAGE) postTheme();
      else if (data?.type === HTML_RENDER_SIZE_MESSAGE && typeof data.height === 'number' && Number.isFinite(data.height)) {
        setHeight(clampHeight(data.height));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postTheme]);

  // A theme switch reaches a page that is already showing.
  useEffect(postTheme, [postTheme]);

  return (
    <div className="group/html-render relative">
      <iframe
        ref={frameRef}
        src={src}
        title={render.title}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        loading="lazy"
        onLoad={postTheme}
        // Matching color schemes keep the frame transparent over the conversation.
        style={{ height, colorScheme: resolvedMode }}
        className="block w-full border-0 bg-transparent"
      />
      <Button
        asChild
        variant="ghost"
        size="icon-xs"
        className={cn('absolute right-1 top-1 bg-background/80',
          'opacity-0 transition-opacity group-hover/html-render:opacity-100 group-focus-within/html-render:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100')}
      >
        <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Open ${render.title} in a new tab`} title="Open in new tab">
          <ExternalLink className="size-3" />
        </a>
      </Button>
    </div>
  );
});
