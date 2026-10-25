import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { GroupComposer } from './GroupComposer';
import { GROUP_MEMBERS, createPromptList } from '../../../.storybook/mocks';

/** The group's message box: `@` lists members, the shield is the whole group's permission mode, Enter sends. */
const meta: Meta<typeof GroupComposer> = {
  title: 'Chat/GroupComposer',
  component: GroupComposer,
  parameters: { layout: 'padded' },
  args: { members: GROUP_MEMBERS, defaultAgentId: 'implementer', permissionMode: 'standard', prompts: createPromptList(), onPermissionModeChange: fn(), onSend: fn() },
  decorators: [(Story) => <div className="mx-auto w-full max-w-3xl rounded-xl border bg-background"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Sending: Story = { args: { sending: true } };

/** Members are working and nothing is typed: the send button is Stop. */
export const MembersWorking: Story = { args: { working: true, onStop: fn() } };

/** Every member runs without approvals. */
export const FullAccess: Story = { args: { permissionMode: 'full' } };

export const Disconnected: Story = { args: { disabled: true } };
