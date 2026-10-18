import { createRef } from 'react';
import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import '@xterm/xterm/css/xterm.css';
import { AppPanels } from './AppPanels';
import type { TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import { useDockStore } from '@/stores/dockStore';
import { createFakeSdkClient, workspaceScene } from '../../../.storybook/harness';

/**
 * The bottom dock host for the terminal: lazy on first open, kept mounted
 * afterwards so shells survive hiding. Embedded mode renders inside a
 * workspace tab instead of the dock.
 */

function withBottomDock(open: boolean) {
  return function BottomDockDecorator(Story: ComponentType) {
    const initial = useDockStore.getInitialState().docks;
    useDockStore.setState({ docks: { ...initial, bottom: { ...initial.bottom, open } } });
    return <Story />;
  };
}

const client = createFakeSdkClient({
  http: { terminals: { list: async () => ({ sessions: [] }) } },
  namespaces: { terminal: { subscribeEvents: async () => ({ conn: { on: () => {}, off: () => {}, dispose: () => {}, close: () => {} }, initialSessions: [] }) } },
});

const meta = {
  title: 'Workspace/AppPanels',
  component: AppPanels,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: xterm renders to canvas and measures fonts; happy-dom has neither',
  },
  args: { sdkClient: client, terminalPanelRef: createRef<TerminalPanelHandle>() },
  decorators: [(Story) => <div className="flex h-screen flex-col bg-background p-2"><div className="flex-1 rounded-xl border" /><Story /></div>, ...workspaceScene()],
} satisfies Meta<typeof AppPanels>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DockOpen: Story = {
  decorators: [withBottomDock(true)],
};

export const DockClosed: Story = {
  decorators: [withBottomDock(false)],
};

export const Embedded: Story = {
  args: { embedded: true },
  decorators: [(Story) => <div className="flex h-96 flex-col rounded-xl border bg-sidebar"><Story /></div>],
};

export const Phone: Story = {
  decorators: [withBottomDock(true)],
  globals: { viewport: { value: 'phone' } },
};
