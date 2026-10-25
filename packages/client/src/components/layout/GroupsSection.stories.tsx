import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { GroupsSection } from './GroupsSection';
import { createAgentGroup } from '../../../.storybook/mocks';

/** The workspace's group chats in the sidebar: a row per group with its members, plus to create, menu to edit or delete. */
const groups = [
  createAgentGroup({ id: 'group-1', name: 'API work' }),
  createAgentGroup({ id: 'group-2', name: 'Docs sprint', members: [
    { agentId: 'writer', name: 'Writer', sessionId: 's1', cursorSeq: 0, joinedAt: '' },
    { agentId: 'reviewer', name: 'Reviewer', sessionId: 's2', cursorSeq: 0, joinedAt: '' },
  ] }),
];

const meta: Meta<typeof GroupsSection> = {
  title: 'Sessions/GroupsSection',
  component: GroupsSection,
  parameters: { layout: 'padded' },
  args: { groups, loaded: true, activeGroupIds: new Set(['group-1']), onOpenGroup: fn(), onCreateGroup: fn(), onEditGroup: fn(), onDeleteGroup: fn() },
  decorators: [(Story) => <div className="w-72 rounded-xl bg-sidebar p-1 text-sidebar-foreground"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoGroups: Story = {};

export const Empty: Story = { args: { groups: [] } };

export const Loading: Story = { args: { groups: [], loaded: false } };
