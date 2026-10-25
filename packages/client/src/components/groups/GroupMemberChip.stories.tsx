import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { GroupMemberChip } from './GroupMemberChip';

/** A member of a group chat in the group header: name in its thread color, status glyph, menu. */
const meta: Meta<typeof GroupMemberChip> = {
  title: 'Chat/GroupMemberChip',
  component: GroupMemberChip,
  parameters: { layout: 'centered' },
  args: { name: 'Reviewer', status: 'idle', colorClass: 'text-emerald-600 dark:text-emerald-400', onOpenSession: fn(), onStop: fn(), onMakeDefault: fn(), onRemove: fn() },
  decorators: [(Story) => <div className="@container/chips flex w-96 flex-wrap gap-1.5"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

/** A working member's menu offers Stop. */
export const Working: Story = { args: { status: 'working', name: 'Implementer', colorClass: 'text-sky-600 dark:text-sky-400' } };

export const NeedsYou: Story = { args: { status: 'needs-you' } };

export const DefaultMember: Story = { args: { isDefault: true, name: 'Implementer', colorClass: 'text-sky-600 dark:text-sky-400' } };

/** At the minimum of two members nobody can be removed. */
export const CannotRemove: Story = { args: { onRemove: undefined } };
