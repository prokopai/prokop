import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceUsageView } from './WorkspaceUsageView';
import { createFakeSdkClient } from '../../../.storybook/harness';

/** The Usage tab: provider and harness quotas, loaded lazily when the tab is visible. */

const meta = {
  title: 'Workspace/WorkspaceUsageView',
  component: WorkspaceUsageView,
  parameters: { layout: 'fullscreen' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="flex h-screen flex-col overflow-hidden bg-background"><Story /></div>],
} satisfies Meta<typeof WorkspaceUsageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
