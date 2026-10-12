import { useState, useEffect } from 'react';

interface VisualViewportState {
  height: number;
  offsetTop: number;
  scale: number;
  /** The on-screen keyboard covers part of the page. */
  keyboardOpen: boolean;
}

/** A keyboard takes well over this share of the height; browser chrome does not. */
const KEYBOARD_THRESHOLD = 0.85;

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => ({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    offsetTop: 0,
    scale: 1,
    keyboardOpen: false,
  }));

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    // Some browsers shrink the layout viewport with the keyboard too, so
    // compare against the tallest height seen at this width (orientation).
    let fullHeight = { width: 0, height: 0 };
    const update = () => {
      const width = window.innerWidth;
      const height = Math.max(window.innerHeight, viewport.height);
      if (width !== fullHeight.width || height > fullHeight.height) fullHeight = { width, height };
      setState({
        height: viewport.height,
        offsetTop: viewport.offsetTop,
        scale: viewport.scale,
        // Pinch zoom shrinks the visual viewport too; only a keyboard shrinks it unzoomed.
        keyboardOpen: viewport.height * viewport.scale < fullHeight.height * KEYBOARD_THRESHOLD,
      });
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return state;
}
