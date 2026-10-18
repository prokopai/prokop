import type { Meta, StoryObj } from '@storybook/react-vite';
import { NotificationsPanel } from './NotificationsPanel';
import { withUIStore } from '../../../../.storybook/mocks/storeDecorators';
import { withSdkClient } from '../../../../.storybook/harness';

/** Sound toggles plus the system notification controls (which depend on the browser). */

const meta = {
  title: 'Settings/NotificationsPanel',
  component: NotificationsPanel,
  parameters: { layout: 'padded' },
  decorators: [withUIStore(), withSdkClient(), (Story) => <div className="w-[36rem] rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof NotificationsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SoundsOff: Story = {
  decorators: [withUIStore({ chatFinishSoundEnabled: false, permissionSoundEnabled: false })],
};
