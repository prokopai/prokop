import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { GroupDialog } from './GroupDialog';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createAgentGroup, createPreconfigList } from '../../../.storybook/mocks';
import { withServerDataStore } from '../../../.storybook/mocks/storeDecorators';

/** Create or edit a group: name, members from the agent list, default member. */
const meta: Meta<typeof GroupDialog> = {
  title: 'Dialogs/GroupDialog',
  component: GroupDialog,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: fn(), sdkClient: createFakeSdkClient(), workspaceId: 'ws-1', editingGroup: null, onCreated: fn() },
  decorators: [withServerDataStore({ preconfigs: createPreconfigList() })],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {};

export const Edit: Story = {
  args: {
    editingGroup: createAgentGroup({
      members: [
        { agentId: createPreconfigList()[0]!.id, name: createPreconfigList()[0]!.name, sessionId: 's1', cursorSeq: 0, joinedAt: '' },
        { agentId: 'tester', name: 'Tester (removed agent)', sessionId: 's2', cursorSeq: 0, joinedAt: '' },
      ],
      defaultAgentId: createPreconfigList()[0]!.id,
    }),
  },
};

export const NoAgents: Story = { decorators: [withServerDataStore({ preconfigs: [] })] };
