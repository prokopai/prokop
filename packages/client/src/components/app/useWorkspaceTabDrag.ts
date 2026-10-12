import { useEffect, useRef, useState } from 'react';
import type { DragEvent, RefObject } from 'react';
import type { WorkspaceViewId } from '@/stores/workspaceViewStore';

/** What a strip drags: its payload type and the attribute naming each tab's id. */
export interface TabDragKind {
  type: string;
  idAttribute: string;
}

const WORKSPACE_TAB_DRAG: TabDragKind = {
  type: 'application/x-prokop-workspace-tab',
  idAttribute: 'data-workspace-tab-id',
};

// Only accept a tab drag started in this document, never an external payload.
let activeDrag: { kind: TabDragKind; id: string; source: HTMLElement } | null = null;

interface Insertion<Id extends string> {
  beforeId: Id | null;
  left: number;
}

function insertionAt<Id extends string>(scroller: HTMLDivElement, clientX: number, kind: TabDragKind): Insertion<Id> {
  const bounds = scroller.getBoundingClientRect();
  const tabs = Array.from(scroller.querySelectorAll<HTMLElement>(`[${kind.idAttribute}]`));
  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { beforeId: tab.getAttribute(kind.idAttribute) as Id, left: rect.left - bounds.left + scroller.scrollLeft };
    }
  }
  const last = tabs.at(-1)?.getBoundingClientRect();
  return { beforeId: null, left: last ? last.right - bounds.left + scroller.scrollLeft : scroller.scrollLeft + 2 };
}

export function useWorkspaceTabDrag(
  scrollerRef: RefObject<HTMLDivElement | null>,
  onMove?: (id: WorkspaceViewId, beforeId: WorkspaceViewId | null) => void,
) {
  return useTabDrag(scrollerRef, WORKSPACE_TAB_DRAG, onMove);
}

/** Drag to reorder within a horizontal tab strip; only drops of the same kind land. */
export function useTabDrag<Id extends string>(
  scrollerRef: RefObject<HTMLDivElement | null>,
  kind: TabDragKind,
  onMove?: (id: Id, beforeId: Id | null) => void,
) {
  const [insertion, setInsertion] = useState<Insertion<Id> | null>(null);
  const frame = useRef<number | null>(null);
  const pointerX = useRef(0);

  const reset = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setInsertion(null);
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    const end = () => {
      activeDrag = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      setInsertion(null);
    };
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
      window.removeEventListener('blur', end);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (activeDrag && scroller?.contains(activeDrag.source)) activeDrag = null;
    };
  }, [scrollerRef]);

  const accepts = (event: DragEvent) => !!onMove && activeDrag?.kind === kind && activeDrag.source.isConnected
    && !activeDrag.source.closest('[inert], [aria-hidden="true"]')
    && !event.currentTarget.closest('[inert], [aria-hidden="true"]')
    && event.dataTransfer.types.includes(kind.type);

  const updateInsertion = (scroller: HTMLDivElement) => {
    const next = insertionAt<Id>(scroller, pointerX.current, kind);
    setInsertion((previous) => previous?.beforeId === next.beforeId && previous.left === next.left ? previous : next);
  };

  const scrollAtEdge = () => {
    const scroller = scrollerRef.current;
    if (!scroller || !activeDrag?.source.isConnected) { reset(); return; }
    const bounds = scroller.getBoundingClientRect();
    const edge = Math.min(36, bounds.width / 3);
    const x = pointerX.current;
    const speed = x < bounds.left + edge ? -8 * Math.min(1, (bounds.left + edge - x) / edge)
      : x > bounds.right - edge ? 8 * Math.min(1, (x - bounds.right + edge) / edge) : 0;
    scroller.scrollLeft += speed;
    updateInsertion(scroller);
    frame.current = requestAnimationFrame(scrollAtEdge);
  };

  return {
    insertion,
    start: (id: Id, event: DragEvent<HTMLElement>) => {
      if (!onMove) { event.preventDefault(); return; }
      activeDrag = { kind, id, source: event.currentTarget };
      event.dataTransfer.setData(kind.type, id);
      event.dataTransfer.effectAllowed = 'move';
      event.stopPropagation();
    },
    stripEvents: {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        pointerX.current = event.clientX;
        updateInsertion(event.currentTarget);
        if (frame.current === null) frame.current = requestAnimationFrame(scrollAtEdge);
      },
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) reset();
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!accepts(event) || !activeDrag) return;
        event.preventDefault();
        const id = activeDrag.id as Id;
        const target = insertionAt<Id>(event.currentTarget, event.clientX, kind);
        activeDrag = null;
        reset();
        onMove?.(id, target.beforeId);
      },
    },
  };
}
