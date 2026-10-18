import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { HeaderPanelToggles } from './HeaderPanelToggles';

/** Dock toggles, update badge and the settings button at the right end of the header. */

const meta = {
  title: 'Workspace/HeaderPanelToggles',
  component: HeaderPanelToggles,
  parameters: { layout: 'centered' },
  args: {
    leftActive: true,
    onToggleLeft: fn(),
    rightActive: false,
    onToggleRight: fn(),
    bottomActive: false,
    onToggleBottom: fn(),
    hasRightDock: true,
    onOpenSettings: fn(),
  },
} satisfies Meta<typeof HeaderPanelToggles>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllOpen: Story = {
  args: { leftActive: true, rightActive: true, bottomActive: true },
};

export const NoWorkspace: Story = {
  args: { hasRightDock: false, rightActive: false },
};

export const UpdateAvailable: Story = {
  args: { updateVersion: '1.25.0' },
};

export const Mobile: Story = {
  args: { mobile: true },
  globals: { viewport: { value: 'phone' } },
};
