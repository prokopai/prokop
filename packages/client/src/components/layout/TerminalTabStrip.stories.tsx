import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PlusIcon } from 'lucide-react';
import { TerminalTabStrip } from './TerminalTabStrip';
import { Button } from '@/components/ui/button';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { withSessionStore } from '../../../.storybook/mocks/storeDecorators';
import { createTerminalTab, createTerminalTabs } from '../../../.storybook/mocks/mockSidebar';

/** Tabs across the top of the terminal dock: status dot, agent badge, rename, close, drag to reorder. */

const tabs = createTerminalTabs();
const owner = createSession({ id: 'sess-1', title: 'Refactor the auth module' });

const meta = {
  title: 'Terminal/TerminalTabStrip',
  component: TerminalTabStrip,
  parameters: { layout: 'padded' },
  args: {
    tabs,
    activeId: tabs[0]!.serverSessionId,
    onActivate: fn(),
    onClose: fn(),
    onRename: fn(),
    onMove: fn(),
    trailing: <Button variant="ghost" size="icon-xs" aria-label="New terminal"><PlusIcon /></Button>,
  },
  decorators: [withSessionStore({ sessions: [owner] }), (Story) => <div className="w-[40rem] rounded-xl border bg-sidebar text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof TerminalTabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Compact: Story = {
  args: { compact: true },
};

export const SingleTab: Story = {
  args: { tabs: tabs.slice(0, 1) },
};

export const ManyTabs: Story = {
  args: { tabs: Array.from({ length: 14 }, (_, i) => createTerminalTab({ serverSessionId: `t-${i}`, title: i % 3 ? `shell ${i}` : `bun run dev --port ${3000 + i}` })) },
};

export const NoActiveTab: Story = {
  args: { activeId: null },
};

export const Phone: Story = {
  args: { compact: true },
  globals: { viewport: { value: 'phone' } },
};
