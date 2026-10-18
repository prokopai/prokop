import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { NotificationSettings } from './NotificationSettings';
import { useNotificationStore } from '@/stores/notificationStore';
import { withSdkClient } from '../../../../.storybook/harness';

/**
 * Push notification enrolment for this device. The browser decides support
 * and permission; the store is seeded here to show each state.
 */

function withNotificationState(state: Record<string, unknown>) {
  return function NotificationStateDecorator(Story: ComponentType) {
    useNotificationStore.setState(state as never);
    return <Story />;
  };
}

const meta = {
  title: 'Settings/NotificationSettings',
  component: NotificationSettings,
  parameters: { layout: 'padded' },
  decorators: [withSdkClient(), (Story) => <div className="w-[36rem] rounded-xl border bg-background p-4"><Story /></div>],
} satisfies Meta<typeof NotificationSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Supported: Story = {
  decorators: [withNotificationState({ support: 'supported', registrationState: 'idle', permission: 'default', registration: null, error: null })],
};

export const Enabled: Story = {
  decorators: [withNotificationState({ support: 'supported', registrationState: 'enabled', permission: 'granted', registration: { id: 'sub-1', notifyCompletion: true, notifyPermission: true }, error: null })],
};

export const Enabling: Story = {
  decorators: [withNotificationState({ support: 'supported', registrationState: 'enabling', permission: 'default', registration: null, error: null })],
};

export const Denied: Story = {
  decorators: [withNotificationState({ support: 'supported', registrationState: 'denied', permission: 'denied', registration: null, error: null })],
};

export const Failed: Story = {
  decorators: [withNotificationState({ support: 'supported', registrationState: 'idle', permission: 'granted', registration: null, error: 'The server has no VAPID key configured.' })],
};

export const Unsupported: Story = {
  decorators: [withNotificationState({ support: 'unsupported', registrationState: 'idle', permission: 'default', registration: null, error: null })],
};
