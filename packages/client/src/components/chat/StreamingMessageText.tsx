import { memo, useState } from 'react';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import {
  assignRevealDelays,
  isRevealWhitespace,
  revealBatch,
  splitRevealTokens,
  STREAM_REVEAL_GENERATIONS,
} from '@/components/shared/markdownStreamReveal';
import { splitStreamingText } from './streamingText';

const StreamBlock = memo(function StreamBlock({ block }: { block: string }) {
  return <MarkdownRenderer>{block}</MarkdownRenderer>;
});

const NO_REVEAL_BATCHES: readonly number[] = [];

/**
 * Offsets in `text` where each of the last few changes started, oldest
 * first: the words that arrived in those flushes are still fading in. A
 * mount starts with nothing to reveal (no replay), and a re-render without
 * new text keeps the same batches, so running fades continue.
 */
function useRevealBatches(text: string): readonly number[] {
  const [state, setState] = useState({ text, batches: NO_REVEAL_BATCHES });
  if (state.text !== text) {
    const start = Math.min(state.text.length, text.length);
    setState({
      text,
      batches: [...state.batches.filter((batch) => batch < start), start].slice(-STREAM_REVEAL_GENERATIONS),
    });
  }
  return state.batches;
}

/**
 * Streamed text renders once per store flush, never per frame. Finished
 * blocks are memoized and never re-parse; only the growing tail does, and its
 * newest words fade in through CSS. Same renderer for tail and blocks, so a
 * block graduating from the tail is pixel-identical (no typography pop).
 */
export function StreamingText({ text, active }: { text: string; active: boolean }) {
  const batches = useRevealBatches(text);
  // Frozen first-render flag: a fresh mount of already-complete text skips the
  // block split and renders once (identical visuals, single parse).
  const [mountedInactive] = useState(!active);

  if (!active && mountedInactive) {
    return <MarkdownRenderer>{text}</MarkdownRenderer>;
  }

  const { blocks, tail } = splitStreamingText(text);
  const tailStart = text.length - tail.length;
  // Only the live tail part fades; a part that stopped streaming renders settled.
  const tailBatches = active ? batches.map((batch) => batch - tailStart) : undefined;

  return (
    <div className="min-w-0">
      {blocks.map((block, index) => (
        <StreamBlock key={`${index}:${block.length}`} block={block} />
      ))}
      {tail && <MarkdownRenderer revealBatches={tailBatches}>{tail}</MarkdownRenderer>}
    </div>
  );
}

/**
 * Reasoning is plain text. Earlier paragraphs render as one text node; the
 * current one wraps each word so its newest words can fade in.
 */
export function StreamingReasoning({ text, active }: { text: string; active: boolean }) {
  const batches = useRevealBatches(text);
  if (!active) return <>{text}</>;
  const paragraphStart = text.lastIndexOf('\n\n') + 1;
  let position = paragraphStart;
  const tokens = splitRevealTokens(text.slice(paragraphStart)).map((token) => {
    const offset = position;
    position += token.length;
    return { token, batch: isRevealWhitespace(token) ? null : revealBatch(offset, batches) };
  });
  const reveal = assignRevealDelays(tokens.flatMap(({ batch }) => batch === null ? [] : [batch]));
  let wordIndex = 0;
  return (
    <>
      {text.slice(0, paragraphStart)}
      {tokens.map(({ token, batch }, index) => {
        if (batch === null) return token;
        const { delayMs } = reveal[wordIndex++];
        return batch < 0
          ? <span key={index}>{token}</span>
          : <span key={index} className="stream-in" style={{ animationDelay: `${delayMs}ms` }}>{token}</span>;
      })}
    </>
  );
}
