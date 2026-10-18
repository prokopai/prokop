import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PermissionMode } from '@prokopai/sdk';
import { AutoApproveSelector } from './AutoApproveSelector';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { withSessionStore } from '../../../.storybook/mocks/storeDecorators';
import { createFakeSdkClient } from '../../../.storybook/harness';

/**
 * The permission mode shield in the composer. Changing it updates the session
 * through the SDK; the fake client answers with the new mode.
 */

function sessionWith(mode: PermissionMode) {
  return createSession({ id: `sess-${mode}`, title: 'Permission demo', permissionMode: mode });
}

const client = createFakeSdkClient({
  http: {
    sessions: {
      update: async (id, data) => ({ session: createSession({ id, permissionMode: data.permissionMode }) }),
    },
  },
});

const meta = {
  title: 'Chat/AutoApproveSelector',
  component: AutoApproveSelector,
  parameters: { layout: 'centered' },
  args: { sessionId: 'sess-standard', sdkClient: client },
  decorators: [withSessionStore({ sessions: [sessionWith('standard'), sessionWith('extended'), sessionWith('full')] })],
} satisfies Meta<typeof AutoApproveSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {};

export const Extended: Story = {
  args: { sessionId: 'sess-extended' },
};

export const FullAccess: Story = {
  args: { sessionId: 'sess-full' },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
