import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DesktopPanelDivider } from './DesktopPanelDivider';

/** The resize handle between docks and panes. Drag it, or focus it and use the arrow keys. */

function Resizable({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  const [size, setSize] = useState(280);
  const min = 160;
  const max = 520;
  const vertical = orientation === 'vertical';
  return (
    <div className={`flex h-96 w-[40rem] rounded-xl border bg-background ${vertical ? 'flex-row' : 'flex-col'}`}>
      <div className="flex items-center justify-center bg-sidebar text-xs text-muted-foreground" style={{ [vertical ? 'width' : 'height']: size }}>
        {Math.round(size)}px
      </div>
      <DesktopPanelDivider
        label={`Resize ${orientation} panel`}
        orientation={orientation}
        min={min}
        max={max}
        value={size}
        onKeyDown={(event) => {
          const grow = vertical ? 'ArrowRight' : 'ArrowDown';
          const shrink = vertical ? 'ArrowLeft' : 'ArrowUp';
          if (event.key !== grow && event.key !== shrink) return;
          event.preventDefault();
          setSize((value) => Math.max(min, Math.min(max, value + (event.key === grow ? 16 : -16))));
        }}
        onPointerDown={(event) => {
          const start = vertical ? event.clientX : event.clientY;
          const initial = size;
          const move = (next: PointerEvent) => setSize(Math.max(min, Math.min(max, initial + ((vertical ? next.clientX : next.clientY) - start))));
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">content</div>
    </div>
  );
}

const meta = {
  title: 'Workspace/DesktopPanelDivider',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = { render: () => <Resizable orientation="vertical" /> };
export const Horizontal: Story = { render: () => <Resizable orientation="horizontal" /> };
