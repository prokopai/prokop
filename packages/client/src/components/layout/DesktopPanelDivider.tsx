import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import { cn } from '@/lib/utils';

interface DesktopPanelDividerProps {
  label: string;
  orientation?: 'vertical' | 'horizontal';
  min: number;
  max: number;
  value: number;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
}

/** Shared resize affordance for inline desktop workspace panels. */
export function DesktopPanelDivider({
  label,
  orientation = 'vertical',
  min,
  max,
  value,
  onKeyDown,
  onPointerDown,
}: DesktopPanelDividerProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      data-slot="desktop-panel-divider"
      className={cn(
        "group/divider relative z-10 shrink-0 touch-none bg-border/50 outline-none after:absolute after:content-['']",
        orientation === 'vertical'
          ? 'w-px cursor-ew-resize after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2'
          : 'h-px cursor-ns-resize after:inset-x-0 after:top-1/2 after:h-3 after:-translate-y-1/2',
      )}
    >
      <div
        data-slot="desktop-panel-divider-indicator"
        className={cn(
          'absolute z-10 bg-transparent transition-colors group-hover/divider:bg-highlight group-focus-visible/divider:bg-highlight',
          orientation === 'vertical'
            ? 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2',
        )}
      />
    </div>
  );
}
