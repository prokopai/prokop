import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AppFrameSkeleton } from './AppFrameSkeleton';
import { Button } from '@/components/ui/button';
import { useDockStore, type DockPosition } from '@/stores/dockStore';

/**
 * The frame shown while the app starts: title bar, docks at their saved
 * sizes, an empty center with a status line. It matches the loaded layout so
 * nothing jumps when content arrives.
 */

function withDocks(open: Partial<Record<DockPosition, boolean>>) {
  return function DockDecorator(Story: ComponentType) {
    const initial = useDockStore.getInitialState().docks;
    useDockStore.setState({ docks: { left: { ...initial.left, open: open.left ?? true }, right: { ...initial.right, open: open.right ?? true }, bottom: { ...initial.bottom, open: open.bottom ?? false } } });
    return <Story />;
  };
}

const meta = {
  title: 'Shell/AppFrameSkeleton',
  component: AppFrameSkeleton,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="h-screen"><Story /></div>, withDocks({})],
} satisfies Meta<typeof AppFrameSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = {};

export const Connecting: Story = {
  args: { status: 'Connecting to Studio…' },
};

export const Unreachable: Story = {
  args: {
    status: 'Studio is not answering.',
    children: (
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={fn()}>Retry</Button>
        <Button size="sm" variant="ghost" onClick={fn()}>Change server</Button>
      </div>
    ),
  },
};

export const NoDocks: Story = {
  decorators: [withDocks({ left: false, right: false })],
};

export const Phone: Story = {
  args: { status: 'Connecting…' },
  globals: { viewport: { value: 'phone' } },
};
