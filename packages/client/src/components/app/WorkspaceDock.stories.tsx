import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceDock } from './WorkspaceDock';
import { DockRegion } from '@/components/layout/DockRegion';
import { useDockStore, type DockPosition } from '@/stores/dockStore';

/**
 * The positional frame of the workspace: left and right docks beside the
 * center, the bottom dock under it. When the row is too narrow for both side
 * docks, the one opened last stays.
 */

function withDocks(open: Partial<Record<DockPosition, boolean>>) {
  return function DockDecorator(Story: ComponentType) {
    const initial = useDockStore.getInitialState().docks;
    useDockStore.setState({
      lastOpenedSide: 'right',
      docks: {
        left: { ...initial.left, open: open.left ?? false },
        right: { ...initial.right, open: open.right ?? false },
        bottom: { ...initial.bottom, open: open.bottom ?? false },
      },
    });
    return <Story />;
  };
}

function Slot({ label }: { label: string }) {
  return <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">{label}</div>;
}

const meta = {
  title: 'Workspace/WorkspaceDock',
  component: WorkspaceDock,
  parameters: { layout: 'fullscreen' },
  args: {
    left: <DockRegion position="left"><Slot label="left: sessions" /></DockRegion>,
    center: <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/50"><Slot label="center: conversation" /></div>,
    right: <DockRegion position="right"><Slot label="right: files" /></DockRegion>,
    bottom: <DockRegion position="bottom"><Slot label="bottom: terminal" /></DockRegion>,
  },
  decorators: [(Story) => <div className="flex h-screen flex-col bg-background"><Story /></div>],
} satisfies Meta<typeof WorkspaceDock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllOpen: Story = { decorators: [withDocks({ left: true, right: true, bottom: true })] };
export const LeftAndCenter: Story = { decorators: [withDocks({ left: true })] };
export const CenterOnly: Story = { decorators: [withDocks({})] };
export const BottomOnly: Story = { decorators: [withDocks({ bottom: true })] };
export const Laptop: Story = { decorators: [withDocks({ left: true, right: true })], globals: { viewport: { value: 'laptop' } } };
