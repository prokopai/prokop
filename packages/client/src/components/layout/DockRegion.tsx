import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { DesktopPanelDivider } from '@/components/layout/DesktopPanelDivider';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { cn } from '@/lib/utils';
import { DOCK_DIVIDER_WIDTH, DOCK_SIZE_LIMITS, dockMaxSize, useDockStore } from '@/stores/dockStore';
import type { DockPosition } from '@/stores/dockStore';

interface DockRegionProps {
  position: DockPosition;
  children: ReactNode;
  /** Content supplies its own mobile presentation; keep the same React ancestry. */
  contents?: boolean;
}

/**
 * Placement owns geometry and visibility; content keeps its own lifetime.
 *
 * A dock is always inline. Its shown size is bounded by its container so the
 * center keeps its minimum; the bound never overwrites the size the user
 * saved. The left dock's container also holds the right dock, so the right
 * dock's width is reserved when it is open. When the row cannot hold both side
 * docks at all, the row (not this component) closes the older one.
 */
export function DockRegion({ position, children, contents = false }: DockRegionProps) {
  const dock = useDockStore((state) => state.docks[position]);
  const setDockSize = useDockStore((state) => state.setDockSize);
  const reserved = useDockStore((state) => (
    position === 'left' && state.docks.right.open ? state.docks.right.size + DOCK_DIVIDER_WIDTH : 0
  ));
  const regionRef = useRef<HTMLElement>(null);
  const limits = DOCK_SIZE_LIMITS[position];
  const [extent, setExtent] = useState<number>(0);
  const horizontal = position === 'bottom';
  const maximum = extent > 0
    ? Math.max(limits.min, Math.min(limits.max, dockMaxSize(position, extent, reserved)))
    : limits.max;
  const size = Math.min(dock.size, maximum);

  useEffect(() => {
    if (contents) return;
    const container = regionRef.current?.parentElement;
    if (!container) return;
    let frame: number | null = null;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const next = horizontal ? rect.height : rect.width;
      if (next > 0) setExtent(next);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; measure(); });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [horizontal, contents]);

  const clamp = useCallback((value: number) => (
    Math.max(limits.min, Math.min(maximum, value))
  ), [limits.min, maximum]);

  const resize = useCallback((event: PointerEvent): number | null => {
    const region = regionRef.current;
    if (!region) return null;
    const rect = region.getBoundingClientRect();
    const next = clamp(position === 'left'
      ? event.clientX - rect.left
      : position === 'right' ? rect.right - event.clientX : rect.bottom - event.clientY);
    region.style.setProperty('--dock-size', `${next}px`);
    return next;
  }, [clamp, position]);

  const commitSize = useCallback((value: number) => {
    setDockSize(position, value);
  }, [position, setDockSize]);

  const onPointerDown = usePointerDrag({
    cursor: horizontal ? 'ns-resize' : 'ew-resize',
    onMove: resize,
    onCommit: commitSize,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = position === 'left' ? 'ArrowRight' : horizontal ? 'ArrowUp' : 'ArrowLeft';
    const shrink = position === 'left' ? 'ArrowLeft' : horizontal ? 'ArrowDown' : 'ArrowRight';
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    const next = clamp(size + (event.key === grow ? 16 : -16));
    regionRef.current?.style.setProperty('--dock-size', `${next}px`);
    commitSize(next);
  };

  const divider = dock.open && !contents && (
    <DesktopPanelDivider
      label={`Resize ${position} dock`}
      orientation={horizontal ? 'horizontal' : 'vertical'}
      min={limits.min}
      max={maximum}
      value={size}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );

  return (
    <>
      {position !== 'left' && divider}
      <section
        ref={regionRef}
        aria-label={`${position[0].toUpperCase()}${position.slice(1)} dock`}
        aria-hidden={!dock.open}
        inert={!dock.open}
        data-dock-position={position}
        data-state={dock.open ? 'expanded' : 'collapsed'}
        className={contents ? 'contents' : cn(
          'glass-panel flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-3xl bg-sidebar text-sidebar-foreground',
          !dock.open && 'invisible pointer-events-none',
        )}
        style={contents ? undefined : {
          '--dock-size': `${size}px`,
          [horizontal ? 'height' : 'width']: dock.open ? 'var(--dock-size)' : 0,
        } as CSSProperties}
      >
        {children}
      </section>
      {position === 'left' && divider}
    </>
  );
}
