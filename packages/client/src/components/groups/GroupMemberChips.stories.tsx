import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { AgentGroupMember } from '@prokopai/sdk';
import { GroupMemberChips, type GroupMemberChipEntry } from './GroupMemberChips';
import { authorColorClass } from '@/lib/groupAuthors';
import type { GroupMemberStatus } from '@/hooks/useGroupMemberStatuses';

/** The members row of a group header: what fits, most urgent first, and a "+N" chip for the rest. */
const NAMES = ['Implementer', 'Reviewer', 'Idea Architect', 'Researcher', 'Tester', 'Writer', 'Designer', 'Ops', 'Security', 'Planner'];
const members: AgentGroupMember[] = NAMES.map((name, index) => ({
  agentId: name.toLowerCase().replace(/\s+/g, '-'), name, sessionId: `sess-${index}`, cursorSeq: 0, joinedAt: '2026-10-24T00:00:00.000Z',
}));
const statuses: GroupMemberStatus[] = ['idle', 'working', 'idle', 'idle', 'idle', 'idle', 'idle', 'needs-you', 'idle', 'idle'];

function entries(count: number): GroupMemberChipEntry[] {
  return members.slice(0, count).map((member, index) => ({
    member, status: statuses[index]!, isDefault: index === 0, colorClass: authorColorClass(member.agentId, members),
    onOpenSession: fn(), onStop: fn(), onMakeDefault: fn(), onRemove: fn(),
  }));
}

const meta: Meta<typeof GroupMemberChips> = {
  title: 'Chat/GroupMemberChips',
  component: GroupMemberChips,
  parameters: { layout: 'padded' },
  args: { entries: entries(10) },
  decorators: [(Story) => <div className="@container/chips flex h-9 w-[36rem] max-w-full items-center rounded-md border px-2"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Ten members in a pane the width of a session header: the one that needs you and the working one come first. */
export const TenMembers: Story = {};

/** Three members fit without folding. */
export const Three: Story = { args: { entries: entries(3) } };

/** A phone-wide row keeps two or three and folds the rest. */
export const Narrow: Story = {
  decorators: [(Story) => <div className="@container/chips flex h-9 w-72 items-center rounded-md border px-2"><Story /></div>],
};
