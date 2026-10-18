import { useState, type ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceViewGroup } from './WorkspaceViewGroup';
import type { WorkspaceTab } from './workspaceTab';
import { createDefaultViewLayout, useWorkspaceViewStore, type ViewRegion, type WorkspaceViewId } from '@/stores/workspaceViewStore';

/**
 * One tab group inside a dock: its strip, the group menu (move, split,
 * hide, show hidden views) and the slot the active view portals into.
 */

const ids: WorkspaceViewId[] = ['sessions', 'session:s:a', 'session:s:b', 'file:doc-1', 'explorer', 'changes', 'branches', 'terminals', 'usage'];
const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = {
  'session:s:a': { label: 'Refactor the auth module', status: 'Running' },
  'session:s:b': { label: 'Deploy to staging', status: 'Needs input' },
  'file:doc-1': { label: 'session.ts', dirty: true },
};

function withLayout(mutate?: () => void) {
  return function LayoutDecorator(Story: ComponentType) {
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileSurface: 'chat', mobileTerminalOpen: false });
    useWorkspaceViewStore.getState().ensureViews(ids);
    mutate?.();
    return <Story />;
  };
}

function Group({ region }: { region: ViewRegion }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  void slot;
  return (
    <div className="flex h-96 w-[40rem] flex-col overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground">
      <WorkspaceViewGroup region={region} available={ids} tabs={tabs} slotRef={setSlot} />
    </div>
  );
}

const meta = {
  title: 'Workspace/WorkspaceViewGroup',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Center: Story = {
  decorators: [withLayout()],
  render: () => <Group region="center" />,
};

export const Left: Story = {
  decorators: [withLayout()],
  render: () => <Group region="left" />,
};

export const Right: Story = {
  decorators: [withLayout()],
  render: () => <Group region="right" />,
};

export const WithHiddenViews: Story = {
  decorators: [withLayout(() => { const store = useWorkspaceViewStore.getState(); store.hideView('changes'); store.hideView('usage'); })],
  render: () => <Group region="right" />,
};
