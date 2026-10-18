import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PermissionsPanel } from './PermissionsPanel';
import { createPermissionGrantList } from '../../../../.storybook/mocks/mockSettings';

/** The workspace permission mode and its saved approvals. */

const meta = {
  title: 'Settings/PermissionsPanel',
  component: PermissionsPanel,
  parameters: { layout: 'padded' },
  args: { mode: 'standard', onModeChange: fn(), permissions: createPermissionGrantList(), onRefreshPermissions: fn(), onRevokePermission: fn(), onRevokeAllPermissions: fn() },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof PermissionsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {};
export const Extended: Story = { args: { mode: 'extended' } };
export const FullAccess: Story = { args: { mode: 'full' } };
export const NoGrants: Story = { args: { permissions: [] } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
