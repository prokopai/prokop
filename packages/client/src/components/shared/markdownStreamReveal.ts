/**
 * Streamed text renders once per store flush; the words that arrived in the
 * last few flushes fade in through CSS (`.stream-in`). Nothing animates from
 * JavaScript, so a stream costs one React and markdown pass per flush instead
 * of one per frame.
 *
 * Every word of the live text is wrapped in a span, fading or not. React keys
 * the spans by their order, so new words only append and a word keeps its DOM
 * node, and with it a running fade, across flushes.
 */

/** New words of one flush start fading within this window. */
export const STREAM_REVEAL_WINDOW_MS = 60;
const MAX_WORD_STEP_MS = 15;
/**
 * Flushes whose words keep the fade class. Store flushes are at least 75ms
 * apart and a fade lasts at most window + 150ms (`.stream-in`), so three
 * flushes always outlast it: no fade is cut short by losing its class.
 */
export const STREAM_REVEAL_GENERATIONS = 3;

/** Delay for the index-th of `count` words from one flush, spread across the window. */
export function revealDelayMs(index: number, count: number): number {
  const step = count > 1 ? Math.min(MAX_WORD_STEP_MS, STREAM_REVEAL_WINDOW_MS / (count - 1)) : 0;
  return Math.round(index * step);
}

/** Words and the whitespace between them, in order; whitespace is never wrapped. */
export function splitRevealTokens(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

export function isRevealWhitespace(token: string): boolean {
  return /^\s+$/.test(token);
}

/** Index of the flush a word starting at `offset` arrived in, or -1 if it is older. */
export function revealBatch(offset: number, batchStarts: readonly number[]): number {
  for (let index = batchStarts.length - 1; index >= 0; index--) {
    if (offset >= batchStarts[index]) return index;
  }
  return -1;
}

export interface RevealWord {
  batch: number;
  delayMs: number;
}

/** Fade assignment for words in order, given each word's batch (-1 = settled). */
export function assignRevealDelays(batches: readonly number[]): RevealWord[] {
  const counts = new Map<number, number>();
  for (const batch of batches) counts.set(batch, (counts.get(batch) ?? 0) + 1);
  const seen = new Map<number, number>();
  return batches.map((batch) => {
    const index = seen.get(batch) ?? 0;
    seen.set(batch, index + 1);
    return { batch, delayMs: batch < 0 ? 0 : revealDelayMs(index, counts.get(batch)!) };
  });
}

interface HastText {
  type: 'text';
  value: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

/** Text inside these stays untouched: code is read back as a string, KaTeX owns its markup. */
function skipsReveal(node: HastElement): boolean {
  if (node.tagName === 'code' || node.tagName === 'pre') return true;
  const className = node.properties.className;
  return Array.isArray(className) && className.some((name) => String(name).startsWith('katex'));
}

/**
 * Rehype plugin: wraps every word in a span; words that started at or after
 * one of `batchStarts` (source offsets, oldest first) get `.stream-in` with a
 * delay staggered within their flush.
 */
export function rehypeStreamReveal({ batchStarts }: { batchStarts: readonly number[] }) {
  return (tree: { children?: HastNode[] }) => {
    const words: { node: HastElement; batch: number }[] = [];

    const rewrite = (children: HastNode[]): HastNode[] => children.flatMap((child): HastNode[] => {
      if (child.type === 'element') {
        const element = child as HastElement;
        if (!skipsReveal(element)) element.children = rewrite(element.children);
        return [element];
      }
      if (child.type !== 'text') {
        const parent = child as { children?: HastNode[] };
        if (parent.children) parent.children = rewrite(parent.children);
        return [child];
      }

      const text = child as HastText;
      const end = text.position?.end.offset;
      // Offsets count back from the node's end: new text arrives at the end of
      // the source, and the value can differ from the source earlier on
      // (escapes, trimmed line endings) but not in what just streamed in.
      const base = end === undefined ? undefined : end - text.value.length;
      const nodes: HastNode[] = [];
      let position = 0;
      for (const token of splitRevealTokens(text.value)) {
        const offset = position;
        position += token.length;
        if (isRevealWhitespace(token)) {
          nodes.push({ type: 'text', value: token });
          continue;
        }
        const word: HastElement = { type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: token }] };
        words.push({ node: word, batch: base === undefined ? -1 : revealBatch(base + offset, batchStarts) });
        nodes.push(word);
      }
      return nodes;
    });

    if (tree.children) tree.children = rewrite(tree.children);
    const reveal = assignRevealDelays(words.map((word) => word.batch));
    words.forEach(({ node }, index) => {
      if (reveal[index].batch < 0) return;
      node.properties.className = ['stream-in'];
      node.properties.style = `animation-delay:${reveal[index].delayMs}ms`;
    });
  };
}
