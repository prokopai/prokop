import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import LogoutButton from './LogoutButton';

/** How this device is authenticated, with the disconnect button. */

const meta = {
  title: 'Shell/LogoutButton',
  component: LogoutButton,
  parameters: { layout: 'centered' },
  args: { onLogout: fn() },
} satisfies Meta<typeof LogoutButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PairedDevice: Story = { args: { token: 'pkd_3f9a2c7e1b4d8e6f9a1b' } };
export const SharedToken: Story = { args: { token: 'shared-auth-token-value-0123456789' } };
export const ThisComputer: Story = { args: { token: null } };
