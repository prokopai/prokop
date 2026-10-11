import { memo, useMemo } from 'react';
import type { Components } from 'react-markdown';
import { parseFileReferenceLink, splitContextEnvelope } from '@prokopai/sdk';
import { ContextChip } from './ContextChip';
import { extractText, MarkdownLink, MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { useContextFileOpener } from '@/hooks/useContextFileOpener';

const TERMINAL_HREF = '#context-';

interface UserPromptTextProps {
  text: string;
  sessionId: string;
  inverted?: boolean;
  /** Applied to the body after the context envelope is removed. */
  formatBody?: (body: string) => string;
}

/** A sent prompt: file and terminal references render as chips, the envelope stays hidden. */
export const UserPromptText = memo(function UserPromptText({ text, sessionId, inverted = false, formatBody }: UserPromptTextProps) {
  const { body, terminals } = useMemo(() => splitContextEnvelope(text), [text]);
  const openFile = useContextFileOpener(sessionId);
  const overrides = useMemo<Components>(() => ({
    a({ href, children, node: _node, ...props }) {
      const label = extractText(children);
      if (href?.startsWith(TERMINAL_HREF)) {
        return <ContextChip reference={terminals.get(href.slice(TERMINAL_HREF.length))} label={label} inverted={inverted} />;
      }
      const file = href ? parseFileReferenceLink(label, href) : null;
      if (file) return <ContextChip reference={file} inverted={inverted} onOpenFile={openFile} />;
      return <MarkdownLink href={href} inverted={inverted} {...props}>{children}</MarkdownLink>;
    },
  }), [terminals, openFile, inverted]);

  return (
    <MarkdownRenderer inverted={inverted} overrides={overrides}>
      {formatBody ? formatBody(body) : body}
    </MarkdownRenderer>
  );
});
