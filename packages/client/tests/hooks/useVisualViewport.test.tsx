import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { useVisualViewport } from '@/hooks/useVisualViewport';

const original = window.visualViewport;
let viewport: EventTarget & { height: number; offsetTop: number; scale: number };

function resize(height: number, innerHeight = window.innerHeight, scale = 1) {
  act(() => {
    viewport.height = height;
    viewport.scale = scale;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
    viewport.dispatchEvent(new Event('resize'));
  });
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
});

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: original });
});

test('a keyboard over the layout viewport opens', () => {
  const { result } = renderHook(() => useVisualViewport());
  expect(result.current.keyboardOpen).toBe(false);
  resize(450);
  expect(result.current).toMatchObject({ height: 450, keyboardOpen: true });
  resize(800);
  expect(result.current.keyboardOpen).toBe(false);
});

test('a keyboard that also shrinks the layout viewport opens', () => {
  const { result } = renderHook(() => useVisualViewport());
  resize(450, 450);
  expect(result.current.keyboardOpen).toBe(true);
});

test('pinch zoom is not a keyboard', () => {
  const { result } = renderHook(() => useVisualViewport());
  resize(400, 800, 2);
  expect(result.current.keyboardOpen).toBe(false);
});
