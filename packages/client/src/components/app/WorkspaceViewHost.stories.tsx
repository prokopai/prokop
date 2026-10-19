import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceViewHost, useWorkspaceViewVisible } from './WorkspaceViewHost';
import { Button } from '@/components/ui/button';

/**
 * Portals a view into a dock slot and keeps it mounted when hidden. The
 * content below reads its visibility from context and keeps its state while
 * the host moves between the two slots.
 */

function Content() {
  const visible = useWorkspaceViewVisible();
  const [count, setCount] = useState(0);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-card text-sm">
      <span>visible: {String(visible)}</span>
      <Button variant="outline" onClick={() => setCount((n) => n + 1)}>clicked {count}</Button>
    </div>
  );
}

function Demo() {
  const [left, setLeft] = useState<HTMLDivElement | null>(null);
  const [right, setRight] = useState<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<'left' | 'right'>('left');
  const [visible, setVisible] = useState(true);
  return (
    <div className="flex h-screen flex-col gap-3 bg-background p-3">
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setSlot((s) => (s === 'left' ? 'right' : 'left'))}>Move to {slot === 'left' ? 'right' : 'left'} slot</Button>
        <Button variant="outline" onClick={() => setVisible((v) => !v)}>{visible ? 'Hide' : 'Show'}</Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <div ref={setLeft} className="relative flex-1 rounded-xl border border-dashed" />
        <div ref={setRight} className="relative flex-1 rounded-xl border border-dashed" />
      </div>
      <WorkspaceViewHost id="sessions" label="Demo view" target={slot === 'left' ? left : right} visible={visible}>
        <Content />
      </WorkspaceViewHost>
    </div>
  );
}

const meta = {
  title: 'Workspace/WorkspaceViewHost',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Demo /> };
