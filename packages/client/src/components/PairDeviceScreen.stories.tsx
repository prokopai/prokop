import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PairDeviceScreen } from './PairDeviceScreen';
import { withMemoryRouter, STORY_ROUTES } from '../../.storybook/harness';

/**
 * Shown when this device is not paired with a server. It asks the server for
 * approval on mount; with no server behind the address that request fails,
 * which shows the failure path and the pairing code alternative.
 */

const meta = {
  title: 'Shell/PairDeviceScreen',
  component: PairDeviceScreen,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: asks the server for device approval on mount; happy-dom aborts the pending request at teardown',
  },
  args: { server: { name: 'Studio', url: 'https://storybook.local' }, onPaired: fn() },
  decorators: [(Story) => <div className="h-screen"><Story /></div>, withMemoryRouter(STORY_ROUTES.home)],
} satisfies Meta<typeof PairDeviceScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongServerName: Story = {
  args: { server: { name: 'Office desktop in the corner with the long hostname', url: 'https://office.storybook.local' } },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
