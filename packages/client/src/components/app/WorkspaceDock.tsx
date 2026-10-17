import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { sideDocksFit, useDockStore } from '@/stores/dockStore';

interface WorkspaceDockProps {
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
  bottom?: ReactNode;
}

/**
 * Side docks are exclusive when the row cannot hold both at their minimums
 * beside the center: the dock opened last stays, the other closes. Docks never
 * float over the center; a row that fits both shows both inline.
 */
function useExclusiveSideDocks(rowRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let frame: number | null = null;
    const reconcile = () => {
      const width = row.getBoundingClientRect().width;
      const { docks, lastOpenedSide, setDockOpen } = useDockStore.getState();
      if (width <= 0 || !docks.left.open || !docks.right.open || sideDocksFit(width)) return;
      setDockOpen(lastOpenedSide === 'left' ? 'right' : 'left', false);
    };
    reconcile();
    const unsubscribe = useDockStore.subscribe(reconcile);
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; reconcile(); });
    });
    observer.observe(row);
    return () => {
      unsubscribe();
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [rowRef]);
}

/**
 * Positional slots contain views without assigning a content type to a region.
 */
export function WorkspaceDock({
  left,
  center,
  right,
  bottom,
}: WorkspaceDockProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  useExclusiveSideDocks(rowRef);
  return (
    <main className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
      <div
        data-slot="workspace-dock"
        className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-background sm:p-2 sm:pt-1.5"
      >
        <div
          ref={rowRef}
          data-slot="workspace-dock-row"
          className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden"
        >
          {left}
          <div
            data-slot="workspace-primary-dock"
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <div data-slot="workspace-center-row" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {center}
              {right}
            </div>
            {bottom}
          </div>
        </div>
      </div>
    </main>
  );
}
