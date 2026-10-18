import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DockRegion } from './DockRegion';
import { useDockStore, type DockPosition } from '@/stores/dockStore';

/**
 * One dock: a resizable card on the left, right or bottom of the workspace
 * row. Open state and size live in the dock store; the divider commits sizes.
 */

function withDocks(open: Partial<Record<DockPosition, boolean>>) {
  return function DockDecorator(Story: ComponentType) {
    const initial = useDockStore.getInitialState().docks;
    useDockStore.setState({
      docks: {
        left: { ...initial.left, open: open.left ?? false },
        right: { ...initial.right, open: open.right ?? false },
        bottom: { ...initial.bottom, open: open.bottom ?? false },
      },
    });
    return <Story />;
  };
}

function Content({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">{label}</div>;
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col gap-0 bg-background p-2">
      <div className="flex min-h-0 flex-1 flex-row">{children}</div>
    </div>
  );
}

const meta = {
  title: 'Workspace/DockRegion',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Left: Story = {
  decorators: [withDocks({ left: true })],
  render: () => (
    <Row>
      <DockRegion position="left"><Content label="left dock" /></DockRegion>
      <div className="flex flex-1 items-center justify-center rounded-xl border text-xs text-muted-foreground">primary surface</div>
    </Row>
  ),
};

export const Right: Story = {
  decorators: [withDocks({ right: true })],
  render: () => (
    <Row>
      <div className="flex flex-1 items-center justify-center rounded-xl border text-xs text-muted-foreground">primary surface</div>
      <DockRegion position="right"><Content label="right dock" /></DockRegion>
    </Row>
  ),
};

export const BothSides: Story = {
  decorators: [withDocks({ left: true, right: true })],
  render: () => (
    <Row>
      <DockRegion position="left"><Content label="left dock" /></DockRegion>
      <div className="flex flex-1 items-center justify-center rounded-xl border text-xs text-muted-foreground">primary surface</div>
      <DockRegion position="right"><Content label="right dock" /></DockRegion>
    </Row>
  ),
};

export const Bottom: Story = {
  decorators: [withDocks({ bottom: true })],
  render: () => (
    <div className="flex h-screen flex-col bg-background p-2">
      <div className="flex flex-1 items-center justify-center rounded-xl border text-xs text-muted-foreground">primary surface</div>
      <DockRegion position="bottom"><Content label="bottom dock (terminal)" /></DockRegion>
    </div>
  ),
};

export const Collapsed: Story = {
  decorators: [withDocks({})],
  render: () => (
    <Row>
      <DockRegion position="left"><Content label="hidden" /></DockRegion>
      <div className="flex flex-1 items-center justify-center rounded-xl border text-xs text-muted-foreground">primary surface, both docks collapsed</div>
      <DockRegion position="right"><Content label="hidden" /></DockRegion>
    </Row>
  ),
};
