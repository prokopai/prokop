import { useCallback, useState, type ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceSplitTree } from './WorkspaceSplitTree';
import type { WorkspaceTab } from './workspaceTab';
import { createDefaultViewLayout, useWorkspaceViewStore, type WorkspaceViewId } from '@/stores/workspaceViewStore';

/**
 * A region's groups laid out as nested splits with draggable dividers. The
 * tree comes from the view store; here the center is split once or twice.
 */

const ids: WorkspaceViewId[] = ['sessions', 'session:s:a', 'session:s:b', 'session:s:c', 'file:doc-1', 'explorer', 'terminals'];
const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = {
  'session:s:a': { label: 'Refactor the auth module', status: 'Running' },
  'session:s:b': { label: 'Deploy to staging' },
  'session:s:c': { label: 'Write README' },
  'file:doc-1': { label: 'session.ts', dirty: true },
};

function withSplits(splits: Array<[WorkspaceViewId, 'right' | 'down']>) {
  return function SplitDecorator(Story: ComponentType) {
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileSurface: 'chat', mobileTerminalOpen: false });
    const store = useWorkspaceViewStore.getState();
    store.ensureViews(ids);
    for (const [id, direction] of splits) store.splitView(id, direction, ids);
    return <Story />;
  };
}

function Tree() {
  const layout = useWorkspaceViewStore((state) => state.layout);
  const [, setSlots] = useState<Record<string, HTMLDivElement | null>>({});
  const onSlot = useCallback((id: string, slot: HTMLDivElement | null) => setSlots((previous) => ({ ...previous, [id]: slot })), []);
  return (
    <div className="flex h-screen flex-col bg-background p-2">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border">
        <WorkspaceSplitTree tree={layout.roots.center} region="center" available={ids} tabs={tabs} onSlot={onSlot} />
      </div>
    </div>
  );
}

const meta = {
  title: 'Workspace/WorkspaceSplitTree',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleGroup: Story = { decorators: [withSplits([])], render: () => <Tree /> };
export const SplitRight: Story = { decorators: [withSplits([['session:s:b', 'right']])], render: () => <Tree /> };
export const SplitDown: Story = { decorators: [withSplits([['session:s:b', 'down']])], render: () => <Tree /> };
export const Nested: Story = { decorators: [withSplits([['session:s:b', 'right'], ['session:s:c', 'down']])], render: () => <Tree /> };
