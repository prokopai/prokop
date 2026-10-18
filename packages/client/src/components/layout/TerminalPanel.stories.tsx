import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import '@xterm/xterm/css/xterm.css';
import { TerminalPanel } from './TerminalPanel';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { withConnectionStore, withSessionStore } from '../../../.storybook/mocks/storeDecorators';

/**
 * The terminal dock: tab strip, the active shell, phone key bar. Terminal
 * sessions arrive over a WebSocket events feed; the fake feed answers with a
 * snapshot and never connects a shell, so tabs show their connecting state.
 */

function session(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, pid: 1000, shell: '/bin/zsh', cwd: '/home/user/my-project', cols: 80, rows: 24, title, status: 'running', exitCode: null, createdAt: Date.now() - 60_000, lastActivityAt: Date.now(), activeClientCount: 0, inAlternateScreen: false, origin: 'user', ...extra };
}

function clientWith(initialSessions: ReturnType<typeof session>[]) {
  return createFakeSdkClient({
    http: { terminals: { list: async () => ({ sessions: initialSessions as never }) } },
    namespaces: {
      terminal: {
        subscribeEvents: async () => ({ conn: { on: () => {}, off: () => {}, dispose: () => {}, close: () => {} }, initialSessions }),
        connect: () => new Promise(() => {}),
      },
    },
  });
}

const meta: Meta<typeof TerminalPanel> = {
  title: 'Terminal/TerminalPanel',
  component: TerminalPanel,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: xterm renders to canvas and measures fonts; happy-dom has neither',
  },
  args: {
    workspaceId: 'ws-1',
    workspacePath: '/home/user/my-project',
    workspaceName: 'my-project',
    additionalPaths: [],
    sdkClient: clientWith([session('term-1', 'zsh'), session('term-2', 'bun run dev'), session('term-3', 'agent: bun test', { origin: 'agent' })]),
    isOpen: true,
    onClose: fn(),
  },
  decorators: [
    (Story) => <div className="flex h-screen flex-col bg-background p-2"><div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-sidebar text-sidebar-foreground" data-terminal-panel><Story /></div></div>,
    withConnectionStore({ connected: true }),
    withSessionStore({ sessions: [] }),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTerminals: Story = {};

export const NoTerminals: Story = {
  args: { sdkClient: clientWith([]) },
};

export const WithAdditionalPaths: Story = {
  args: { additionalPaths: ['/home/user/my-project-docs', '/home/user/shared-lib'] },
};

export const Disconnected: Story = {
  decorators: [withConnectionStore({ connected: false })],
};

export const Offline: Story = {
  args: { sdkClient: null },
};

export const Closed: Story = {
  args: { isOpen: false },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
