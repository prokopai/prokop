import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SchedulerJobModal } from './SchedulerJobModal';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { withServerDataStore } from '../../../.storybook/mocks/storeDecorators';
import { scheduledJobPresets } from '../../../.storybook/mocks/mockSidebar';

/** Create or edit a scheduled job: prompt, schedule kind, agent, session reuse, permissions, notifications. */

const meta = {
  title: 'Dialogs/SchedulerJobModal',
  component: SchedulerJobModal,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: fn(), sdkClient: createFakeSdkClient(), workspaceId: 'ws-1', editingJob: null },
  decorators: [withServerDataStore()],
} satisfies Meta<typeof SchedulerJobModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {};
export const EditInterval: Story = { args: { editingJob: scheduledJobPresets.soon } };
export const EditDaily: Story = { args: { editingJob: scheduledJobPresets.active } };
export const EditWeekly: Story = { args: { editingJob: scheduledJobPresets.paused } };
export const EditOnce: Story = { args: { editingJob: scheduledJobPresets.completed } };
export const SaveFails: Story = { args: { sdkClient: createFakeSdkClient({ http: { scheduler: { create: async () => { throw new Error('Cron expression is invalid'); } } } }) } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
