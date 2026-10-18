import type { ComponentType, ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceViews } from './WorkspaceViews';
import type { WorkspaceTab } from './workspaceTab';
import { createDefaultViewLayout, useWorkspaceViewStore, type WorkspaceViewId } from '@/stores/workspaceViewStore';
import { useDockStore, type DockPosition } from '@/stores/dockStore';

/**
 * The whole dock layout driven by the view store: tool views, session,
 * file and pull request tabs placed in groups, split, moved and hidden.
 * Views here are labelled placeholders; the real ones have their own stories.
 */

function Placeholder({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center bg-card text-xs text-muted-foreground">{label}</div>;
}

const ids: WorkspaceViewId[] = ['sessions', 'session:s:a', 'session:s:b', 'file:doc-1', 'prs:s:ws', 'explorer', 'changes', 'branches', 'worktrees', 'terminals', 'usage'];
const views: Partial<Record<WorkspaceViewId, ReactNode>> = Object.fromEntries(ids.map((id) => [id, <Placeholder key={id} label={id} />]));
const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = {
  'session:s:a': { label: 'Refactor the auth module', status: 'Running' },
  'session:s:b': { label: 'Deploy to staging', status: 'Needs input' },
  'file:doc-1': { label: 'session.ts', description: 'my-project · src/auth/session.ts', dirty: true },
  'prs:s:ws': { label: 'Pull requests · my-project' },
};

function withLayout(open: Partial<Record<DockPosition, boolean>>, mutate?: () => void) {
  return function LayoutDecorator(Story: ComponentType) {
    const initial = useDockStore.getInitialState().docks;
    useDockStore.setState({ docks: { left: { ...initial.left, open: open.left ?? true }, right: { ...initial.right, open: open.right ?? true }, bottom: { ...initial.bottom, open: open.bottom ?? false } } });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileSurface: 'chat', mobileTerminalOpen: false });
    useWorkspaceViewStore.getState().ensureViews(ids);
    mutate?.();
    return <Story />;
  };
}

const meta = {
  title: 'Workspace/WorkspaceViews',
  component: WorkspaceViews,
  parameters: { layout: 'fullscreen' },
  args: { views, tabs, mobileSessionId: 'session:s:a', mobileEditorId: 'file:doc-1' },
  decorators: [(Story) => <div className="flex h-screen flex-col bg-background p-2"><Story /></div>],
} satisfies Meta<typeof WorkspaceViews>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultLayout: Story = {
  decorators: [withLayout({})],
};

export const WithTerminal: Story = {
  decorators: [withLayout({ bottom: true })],
};

export const SplitCenter: Story = {
  decorators: [withLayout({}, () => {
    const store = useWorkspaceViewStore.getState();
    store.splitView('session:s:b', 'right', ids);
  })],
};

export const EverythingInCenter: Story = {
  decorators: [withLayout({ left: false, right: false }, () => {
    const store = useWorkspaceViewStore.getState();
    for (const id of ['sessions', 'explorer', 'changes', 'branches', 'worktrees', 'usage'] as WorkspaceViewId[]) store.moveView(id, 'center');
  })],
};

export const OnlySessions: Story = {
  args: { views: { sessions: views.sessions, 'session:s:a': views['session:s:a'] } },
  decorators: [withLayout({ right: false })],
};

export const NothingOpen: Story = {
  args: { views: { sessions: views.sessions }, mobileSessionId: undefined, mobileEditorId: undefined },
  decorators: [withLayout({ right: false })],
};

export const Phone: Story = {
  decorators: [withLayout({})],
  globals: { viewport: { value: 'phone' } },
};

export const PhoneFiles: Story = {
  decorators: [withLayout({}, () => useWorkspaceViewStore.getState().setMobileSurface('files'))],
  globals: { viewport: { value: 'phone' } },
};

export const PhoneEditor: Story = {
  decorators: [withLayout({}, () => useWorkspaceViewStore.getState().setMobileSurface('editor'))],
  globals: { viewport: { value: 'phone' } },
};
