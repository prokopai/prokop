import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ScheduledJobsSection } from './ScheduledJobsSection';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { mockIsoHoursAgo } from '../../../.storybook/mocks/mockHelpers';
import { scheduledJobPresets } from '../../../.storybook/mocks/mockSidebar';

/** Scheduled jobs in the sidebar with their next run, state, and past run sessions. */

const jobs = Object.values(scheduledJobPresets);
const runs = new Map([
  [scheduledJobPresets.active.id, [
    createSession({ title: 'Nightly dependency audit (run 14)', status: 'closed', updatedAt: mockIsoHoursAgo(19) }),
    createSession({ title: 'Nightly dependency audit (run 13)', status: 'closed', updatedAt: mockIsoHoursAgo(43) }),
  ]],
  [scheduledJobPresets.failed.id, [createSession({ title: 'Sync translations (failed)', status: 'closed', updatedAt: mockIsoHoursAgo(2) })]],
  ['job-deleted', [createSession({ title: 'Run of a deleted job', status: 'closed', updatedAt: mockIsoHoursAgo(70) })]],
]);

const callbacks = {
  onCreateJob: fn(),
  onEditJob: fn(),
  onPauseJob: fn(),
  onResumeJob: fn(),
  onTriggerJob: fn(),
  onDeleteJob: fn(),
  onOpenSession: fn(),
};

const meta = {
  title: 'Sessions/ScheduledJobsSection',
  component: ScheduledJobsSection,
  parameters: { layout: 'padded' },
  args: { jobs, jobsLoaded: true, sessionsByJob: runs, currentSessionId: null, sessionCount: 3, ...callbacks },
  decorators: [(Story) => <div className="w-80 rounded-xl border bg-sidebar p-1 text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof ScheduledJobsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoJobs: Story = {
  args: { jobs: [], sessionsByJob: new Map(), sessionCount: 0 },
};

export const PendingActions: Story = {
  args: { pendingJobIds: new Set([scheduledJobPresets.active.id, scheduledJobPresets.paused.id]) },
};

export const JobsStillLoading: Story = {
  args: { jobs: [], jobsLoaded: false },
};

export const CurrentRunOpen: Story = {
  args: { currentSessionId: runs.get(scheduledJobPresets.active.id)![0]!.id },
};

export const LoadingMoreRuns: Story = {
  args: {
    category: { isLoading: false, error: null, hasNextPage: true, isFetchingNextPage: true, fetchNextPage: fn(), loadedCount: 3, retry: fn(), open: true, onOpenChange: fn() } as unknown as NonNullable<Parameters<typeof ScheduledJobsSection>[0]['category']>,
  },
};
