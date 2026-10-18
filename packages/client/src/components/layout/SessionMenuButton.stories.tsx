import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SessionMenuButton } from './SessionMenuButton';
import { SidebarMenu } from '@/components/ui/sidebar';
import { useCompletionStore } from '@/stores/completionStore';
import { createSidebarSessions } from '../../../.storybook/mocks/mockSidebar';

/**
 * One session row in the sidebar: title, status dots, tags, worktree edge,
 * subagent children, rename and the overflow menu.
 */

const { sessions, childrenMap, derived } = createSidebarSessions('ws-1');
const [streaming, waiting, idle, untitled, worktree, parent, , , archived] = sessions;

const callbacks = {
  onResumeSession: fn(),
  onOpenAlongside: fn(),
  onCloseSession: fn(),
  onReopenSession: fn(),
  onDeleteSession: fn(),
  onRename: fn(),
  onRegenerateTitle: fn(),
  onToggleSelect: fn(),
  onAddTag: fn(),
  onRemoveTag: fn(),
};

const meta = {
  title: 'Sessions/SessionMenuButton',
  component: SessionMenuButton,
  parameters: { layout: 'padded' },
  args: { session: idle!, childrenMap, sessionDerivedValues: derived, isActive: false, currentSessionId: null, allWorkspaceTags: ['auth', 'docs', 'ops'], ...callbacks },
  decorators: [(Story) => <div className="w-80 rounded-xl border bg-sidebar p-1 text-sidebar-foreground"><SidebarMenu><Story /></SidebarMenu></div>],
} satisfies Meta<typeof SessionMenuButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Active: Story = {
  args: { isActive: true, currentSessionId: idle!.id },
};

export const Streaming: Story = {
  args: { session: streaming! },
};

export const NeedsApproval: Story = {
  args: { session: waiting! },
};

export const Untitled: Story = {
  args: { session: untitled! },
};

export const InWorktree: Story = {
  args: { session: worktree! },
};

export const WorktreeChipHidden: Story = {
  args: { session: worktree!, hideWorktreeChip: true },
};

export const WithSubagents: Story = {
  args: { session: parent! },
};

export const SubagentActive: Story = {
  args: { session: parent!, currentSessionId: childrenMap.get(parent!.id)![0]!.id },
};

export const Archived: Story = {
  args: { session: archived! },
};

export const SelectionMode: Story = {
  args: { selectionMode: true, selected: false },
};

export const Selected: Story = {
  args: { selectionMode: true, selected: true },
};

export const FinishedWhileAway: Story = {
  decorators: [(Story: ComponentType) => {
    useCompletionStore.setState({ completionState: new Map([[idle!.id, { sessionId: idle!.id, completedAt: Date.now() - 30_000, kind: 'finished' } as never]]) });
    return <Story />;
  }],
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
