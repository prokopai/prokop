import type { JSONContent } from '@tiptap/core';
import {
  parseContextMessage,
  serializeContextSegments,
  type ContextReference,
  type ContextSegment,
} from '@prokopai/sdk';

/**
 * The composer edits a TipTap document, but the prompt string stays the
 * source of truth (drafts, queueing, edits, retries all carry text). These
 * two functions convert between them: each line is a paragraph, each context
 * reference an inline `contextReference` atom.
 */

export const CONTEXT_REFERENCE_NODE = 'contextReference';

function textNode(text: string): JSONContent {
  return { type: 'text', text };
}

export function referenceNode(reference: ContextReference): JSONContent {
  return { type: CONTEXT_REFERENCE_NODE, attrs: { reference } };
}

/** Inline nodes for one prompt fragment, with no paragraph breaks. */
function inlineNodes(segments: ContextSegment[]): JSONContent[][] {
  const lines: JSONContent[][] = [[]];
  for (const segment of segments) {
    if (segment.type === 'reference') {
      lines[lines.length - 1].push(referenceNode(segment.reference));
      continue;
    }
    const text = segment.type === 'text' ? segment.text : segment.source;
    text.split('\n').forEach((line, index) => {
      if (index > 0) lines.push([]);
      if (line) lines[lines.length - 1].push(textNode(line));
    });
  }
  return lines;
}

export function promptToDocument(prompt: string): JSONContent {
  const paragraphs = inlineNodes(parseContextMessage(prompt)).map((content): JSONContent => (
    content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
  ));
  return { type: 'doc', content: paragraphs };
}

/** Paragraph nodes for pasted or inserted prompt text. */
export function promptToParagraphs(prompt: string): JSONContent[] {
  return promptToDocument(prompt).content ?? [];
}

function collectSegments(node: JSONContent, segments: ContextSegment[]): void {
  if (node.type === 'text') {
    segments.push({ type: 'text', text: node.text ?? '' });
  } else if (node.type === CONTEXT_REFERENCE_NODE) {
    const reference = node.attrs?.reference as ContextReference | undefined;
    if (reference) segments.push({ type: 'reference', reference, source: '' });
  } else if (node.type === 'hardBreak') {
    segments.push({ type: 'text', text: '\n' });
  } else {
    for (const child of node.content ?? []) collectSegments(child, segments);
  }
}

/** Works for whole documents and for clipboard slices that start mid-paragraph. */
export function documentToPrompt(document: JSONContent): string {
  const blocks = document.type === 'doc' || !document.type ? document.content ?? [] : [document];
  const segments: ContextSegment[] = [];
  let inline = false;
  blocks.forEach((block, index) => {
    const isParagraph = block.type === 'paragraph';
    if (index > 0 && (isParagraph || !inline)) segments.push({ type: 'text', text: '\n' });
    collectSegments(block, segments);
    inline = !isParagraph;
  });
  return serializeContextSegments(segments);
}
