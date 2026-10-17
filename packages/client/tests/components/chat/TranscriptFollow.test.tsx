import type { ReactNode, Ref } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { VirtualizedTranscript } from '@/components/chat/VirtualizedTranscript';
import type { DisplayItem } from '@/components/chat/VirtualizedTranscript';
import type { TranscriptAnchor } from '@/lib/transcriptFollow';

interface ListProps {
  data: DisplayItem[];
  ref: Ref<unknown>;
  onScroll: () => void;
  maintainScrollAtEnd: unknown;
  initialScrollIndex?: unknown;
  renderItem: (props: { item: DisplayItem }) => ReactNode;
}

// 1000px of content in a 400px viewport; each message is 100px tall.
const { metrics, list, scrollToEnd } = vi.hoisted(() => ({
  metrics: { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 },
  list: { props: null as ListProps | null, element: null as HTMLDivElement | null },
  scrollToEnd: vi.fn(),
}));

vi.mock('@legendapp/list/react', async () => {
  const { useImperativeHandle, useRef } = await vi.importActual<typeof import('react')>('react');
  return {
    LegendList: (props: ListProps) => {
      list.props = props;
      const elementRef = useRef<HTMLDivElement | null>(null);
      useImperativeHandle(props.ref, () => ({
        getScrollableNode: () => elementRef.current,
        getState: () => ({
          data: props.data,
          start: Math.floor(metrics.scrollTop / 100),
          scroll: metrics.scrollTop,
          positionAtIndex: (index: number) => index * 100,
        }),
        scrollToEnd,
        scrollToIndex: vi.fn(),
      }));
      return (
        <div
          ref={(element) => {
            elementRef.current = element;
            list.element = element;
            if (!element) return;
            for (const key of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) {
              Object.defineProperty(element, key, {
                configurable: true,
                get: () => metrics[key],
                set: (value: number) => { metrics[key] = value; },
              });
            }
          }}
        >
          {props.data.map(item => <div key={item.message.id}>{props.renderItem({ item })}</div>)}
        </div>
      );
    },
  };
});
vi.mock('@/components/chat/MessageBubble', () => ({ MessageBubble: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/shared/MarkdownRenderer', () => ({ MarkdownRenderer: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/visualizations', () => ({ StructuredResponse: () => null }));

const resizeCallbacks: Array<() => void> = [];

beforeEach(() => {
  Object.assign(metrics, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
  resizeCallbacks.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const items: DisplayItem[] = Array.from({ length: 10 }, (_, index) => ({
  message: { id: `m${index}`, sessionId: 's', createdAt: index, role: 'user' },
  parts: [],
}));

function transcript(props: Partial<Parameters<typeof VirtualizedTranscript>[0]> = {}) {
  return <VirtualizedTranscript displayItems={items} messagesWithParts={items} sessionId="s" {...props} />;
}

function scrollTo(scrollTop: number) {
  metrics.scrollTop = scrollTop;
  act(() => list.props!.onScroll());
}

test('scrolling up with the keyboard leaves follow mode and stops pinning to the end', () => {
  const onAutoScrollChange = vi.fn();
  render(transcript({ onAutoScrollChange }));
  scrollTo(600);

  fireEvent.keyDown(list.element!, { key: 'PageUp' });
  scrollTo(250);

  expect(onAutoScrollChange).toHaveBeenLastCalledWith(false);
  expect(list.props!.maintainScrollAtEnd).toBe(false);
});

test('dragging the scrollbar up leaves follow mode', () => {
  const onAutoScrollChange = vi.fn();
  render(transcript({ onAutoScrollChange }));
  scrollTo(600);

  fireEvent.mouseDown(list.element!);
  fireEvent.mouseMove(window);
  scrollTo(450);

  expect(onAutoScrollChange).toHaveBeenLastCalledWith(false);
});

test('watches window mouse moves only while the button is held', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const mouseListeners = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'mousemove' || type === 'mouseup').length;
  render(transcript());
  expect(mouseListeners(add)).toBe(0);

  fireEvent.mouseDown(list.element!);
  expect(mouseListeners(add)).toBe(2);
  fireEvent.mouseUp(window);
  expect(mouseListeners(remove)).toBe(2);
  add.mockRestore();
  remove.mockRestore();
});

test('a wheel up stops following before the browser scrolls, so a stream cannot pull it back', () => {
  const onAutoScrollChange = vi.fn();
  render(transcript({ onAutoScrollChange }));
  scrollTo(600);

  fireEvent.wheel(list.element!, { deltaY: -40 });

  expect(onAutoScrollChange).toHaveBeenLastCalledWith(false);
  expect(list.props!.maintainScrollAtEnd).toBe(false);
});

test('a finger dragging the content down stops following', () => {
  const onAutoScrollChange = vi.fn();
  render(transcript({ onAutoScrollChange }));
  scrollTo(600);

  fireEvent.touchStart(list.element!, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(list.element!, { touches: [{ clientY: 110 }] });

  expect(onAutoScrollChange).toHaveBeenLastCalledWith(false);
});

test('a wheel up with nothing above to scroll to keeps following', () => {
  const onAutoScrollChange = vi.fn();
  metrics.scrollTop = 0;
  render(transcript({ onAutoScrollChange }));

  fireEvent.wheel(list.element!, { deltaY: -40 });

  expect(onAutoScrollChange).not.toHaveBeenCalled();
});

test('arrow up while editing a message inside the transcript keeps following', () => {
  const onAutoScrollChange = vi.fn();
  render(transcript({ onAutoScrollChange }));
  scrollTo(600);
  const textarea = document.createElement('textarea');
  list.element!.appendChild(textarea);

  fireEvent.keyDown(textarea, { key: 'ArrowUp' });

  expect(onAutoScrollChange).not.toHaveBeenCalled();
  textarea.remove();
});

test('a sideways wheel that does not move the transcript keeps following', () => {
  const onAutoScrollChange = vi.fn();
  render(transcript({ onAutoScrollChange }));
  scrollTo(600);

  fireEvent.wheel(list.element!, { deltaX: 120, deltaY: -2 });

  expect(onAutoScrollChange).not.toHaveBeenCalled();
});

test('scrolling back to the end resumes following', () => {
  const onAutoScrollChange = vi.fn();
  render(transcript({ onAutoScrollChange, autoFollow: false }));
  scrollTo(300);

  fireEvent.wheel(list.element!, { deltaY: 300 });
  scrollTo(600);

  expect(onAutoScrollChange).toHaveBeenLastCalledWith(true);
});

test('new output only scrolls when the view is not already at the end', () => {
  const view = render(transcript());
  scrollToEnd.mockClear();

  view.rerender(transcript({ displayItems: [...items] }));
  expect(scrollToEnd).not.toHaveBeenCalled();

  metrics.scrollHeight = 1200;
  view.rerender(transcript({ displayItems: [...items] }));
  expect(scrollToEnd).toHaveBeenCalledOnce();
});

test('leaving in free mode saves the first visible message and the offset into it', () => {
  const onSavePosition = vi.fn();
  const view = render(transcript({ onSavePosition, autoFollow: false }));

  fireEvent.wheel(list.element!, { deltaY: -100 });
  scrollTo(250);
  view.unmount();

  expect(onSavePosition).toHaveBeenCalledWith({ messageId: 'm2', offset: 50 });
});

test('leaving while following saves no anchor', () => {
  const onSavePosition = vi.fn();
  const view = render(transcript({ onSavePosition }));
  view.unmount();
  expect(onSavePosition).toHaveBeenCalledWith(null);
});

test('a saved anchor restores to that message and offset', () => {
  const anchor: TranscriptAnchor = { messageId: 'm4', offset: 30 };
  render(transcript({ autoFollow: false, initialAnchor: anchor }));
  expect(list.props!.initialScrollIndex).toEqual({ index: 4, viewOffset: -30 });
});

/** Content grows below the end, as a new row or streamed text does. */
async function grow(by: number) {
  metrics.scrollHeight += by;
  list.element!.appendChild(document.createElement('div'));
  await act(async () => { await Promise.resolve(); });
}

test('a following transcript pins to the end in the same frame content grows', async () => {
  render(transcript());
  scrollTo(600);

  await grow(450);

  expect(metrics.scrollTop).toBe(1050);
});

test('a following transcript stays at the end when the composer shrinks or grows the viewport', () => {
  render(transcript());
  scrollTo(600);

  metrics.clientHeight = 250;
  act(() => resizeCallbacks.forEach(callback => callback()));

  expect(metrics.scrollTop).toBe(750);
});

test('content growth never pulls back a reader who scrolled up', async () => {
  render(transcript());
  scrollTo(600);
  fireEvent.wheel(list.element!, { deltaY: -100 });
  scrollTo(500);

  await grow(450);

  expect(metrics.scrollTop).toBe(500);
});
