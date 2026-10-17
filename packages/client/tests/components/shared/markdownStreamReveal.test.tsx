import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import {
  assignRevealDelays,
  revealBatch,
  revealDelayMs,
  STREAM_REVEAL_WINDOW_MS,
} from '@/components/shared/markdownStreamReveal';

function words(container: HTMLElement) {
  return [...container.querySelectorAll('p span')].map((span) => ({
    text: span.textContent,
    fading: span.classList.contains('stream-in'),
    delay: (span as HTMLElement).style.animationDelay,
  }));
}

describe('stream reveal timing', () => {
  test('spreads one flush across the window and never past it', () => {
    expect(revealDelayMs(0, 1)).toBe(0);
    expect(revealDelayMs(1, 3)).toBe(15);
    expect(revealDelayMs(99, 100)).toBeLessThanOrEqual(STREAM_REVEAL_WINDOW_MS);
  });

  test('a word belongs to the latest flush that started at or before it', () => {
    expect(revealBatch(3, [5, 10])).toBe(-1);
    expect(revealBatch(5, [5, 10])).toBe(0);
    expect(revealBatch(12, [5, 10])).toBe(1);
  });

  test('delays restart for each flush so earlier flushes keep their timing', () => {
    expect(assignRevealDelays([-1, 0, 0, 1]).map((word) => word.delayMs)).toEqual([0, 0, 15, 0]);
  });
});

describe('MarkdownRenderer revealBatches', () => {
  test('fades only the words from recent flushes', () => {
    const { container } = render(<MarkdownRenderer revealBatches={[6]}>Hello brave new world</MarkdownRenderer>);
    expect(words(container)).toEqual([
      { text: 'Hello', fading: false, delay: '' },
      { text: 'brave', fading: true, delay: '0ms' },
      { text: 'new', fading: true, delay: '15ms' },
      { text: 'world', fading: true, delay: '30ms' },
    ]);
    expect(container.querySelector('p')).toHaveTextContent('Hello brave new world');
  });

  test('keeps each word on the same element as text streams in', () => {
    const { container, rerender } = render(<MarkdownRenderer revealBatches={[0]}>Hello brave</MarkdownRenderer>);
    const first = container.querySelectorAll('p span');
    rerender(<MarkdownRenderer revealBatches={[0, 11]}>Hello brave new</MarkdownRenderer>);
    const next = container.querySelectorAll('p span');
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next[2]).toHaveClass('stream-in');
    // The first flush keeps its delays while the second one starts its own.
    expect((next[1] as HTMLElement).style.animationDelay).toBe('15ms');
    expect((next[2] as HTMLElement).style.animationDelay).toBe('0ms');
  });

  test('leaves code untouched so it can be copied and highlighted', () => {
    const { container } = render(
      <MarkdownRenderer revealBatches={[0]}>{'Use `npm test` now\n\n```ts\nconst a = 1;\n```'}</MarkdownRenderer>,
    );
    expect(container.querySelector('p code')?.children).toHaveLength(0);
    expect(container.querySelector('pre .stream-in')).toBeNull();
    expect(container.querySelector('pre')).toHaveTextContent('const a = 1;');
  });

  test('fades words inside emphasis and links', () => {
    const { container } = render(<MarkdownRenderer revealBatches={[0]}>{'Some **bold** and [link](https://x.dev)'}</MarkdownRenderer>);
    expect(container.querySelector('strong .stream-in')).toHaveTextContent('bold');
    expect(container.querySelector('a .stream-in')).toHaveTextContent('link');
  });

  test('renders without spans when nothing is streaming', () => {
    const { container } = render(<MarkdownRenderer>Hello brave new world</MarkdownRenderer>);
    expect(container.querySelector('p span')).toBeNull();
  });
});
