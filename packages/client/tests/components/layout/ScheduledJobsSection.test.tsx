import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ScheduledJob, Session } from '@prokopai/sdk';

vi.mock('@/hooks/useNow', () => ({
  useNow: () => Date.now(),
}));

import { ScheduledJobsSection } from '@/components/layout/ScheduledJobsSection';

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    harness: 'prokop',
    name: 'Test Job',
    prompt: 'Run',
    scheduleKind: 'interval',
    scheduleConfig: { type: 'interval', intervalMinutes: 60 },
    scheduleDisplay: 'Every 60m',
    state: 'active',
    repeatLimit: null,
    runCount: 0,
    nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    lastRunAt: null,
    lastRunSessionId: null,
    lastError: null,
    reuseSession: false,
    includeHistory: false,
    preconfigId: null,
    originSessionId: null,
    autoApproveSeverity: null,
    notificationsEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const noopProps = {
  sessionsByJob: new Map<string, Session[]>(),
  currentSessionId: null,
  onCreateJob: () => {},
  onEditJob: () => {},
  onPauseJob: () => {},
  onResumeJob: () => {},
  onTriggerJob: () => {},
  onDeleteJob: () => {},
  onOpenSession: () => {},
};

describe('ScheduledJobsSection - notifications indicator', () => {
  test('shows session count instead of job count while collapsed', () => {
    render(<ScheduledJobsSection {...noopProps} jobs={[makeJob()]} sessionCount={23} />);
    expect(screen.getByLabelText('Scheduled sessions')).toHaveTextContent('23');
    expect(screen.queryByText('Test Job')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Scheduled'));
    expect(screen.getByText('Test Job')).toBeVisible();
  });

  test('shows the bell indicator when notifications are enabled', () => {
    render(
      <ScheduledJobsSection
        jobs={[makeJob({ notificationsEnabled: true })]}
        {...noopProps}
      />,
    );

    expect(screen.queryByText('Test Job')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Scheduled'));
    expect(screen.getByRole('img', { name: /notifications enabled/i })).toBeInTheDocument();
  });

  test('does not show the bell indicator when notifications are disabled', () => {
    render(
      <ScheduledJobsSection
        jobs={[makeJob({ notificationsEnabled: false })]}
        {...noopProps}
      />,
    );

    fireEvent.click(screen.getByText('Scheduled'));
    expect(screen.queryByRole('img', { name: /notifications enabled/i })).not.toBeInTheDocument();
  });
});

function makeRun(id: string, jobId: string, title: string): Session {
  return {
    id,
    workspaceId: 'ws-1',
    preconfigId: null,
    title,
    status: 'active',
    metadata: { scheduledJobId: jobId },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Session;
}

describe('ScheduledJobsSection - deleting', () => {
  test('job delete asks for confirmation before deleting job and runs', () => {
    const onDeleteJob = vi.fn();
    render(<ScheduledJobsSection {...noopProps} jobs={[makeJob()]} onDeleteJob={onDeleteJob} />);
    fireEvent.click(screen.getByText('Scheduled'));
    fireEvent.pointerDown(screen.getByTitle('Job actions'), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(onDeleteJob).not.toHaveBeenCalled();
    expect(screen.getByText(/every session its runs created/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteJob).toHaveBeenCalledWith('job-1');
  });

  test('runs of a deleted job are grouped and deletable', () => {
    const onDeleteJob = vi.fn();
    const sessionsByJob = new Map([
      ['gone', [makeRun('run-1', 'gone', '[Scheduled] Nightly report'), makeRun('run-2', 'gone', '[Scheduled] Nightly report')]],
    ]);
    render(<ScheduledJobsSection {...noopProps} jobs={[]} sessionsByJob={sessionsByJob} onDeleteJob={onDeleteJob} />);
    fireEvent.click(screen.getByText('Scheduled'));

    expect(screen.getByText('Job deleted')).toBeInTheDocument();
    expect(screen.queryByText('No scheduled jobs.')).not.toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTitle('Run actions'), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteJob).toHaveBeenCalledWith('gone');
  });

  test('runs are not shown as deleted while the job list is unknown', () => {
    const sessionsByJob = new Map([['job-1', [makeRun('run-1', 'job-1', '[Scheduled] Test Job')]]]);
    render(<ScheduledJobsSection {...noopProps} jobs={[]} jobsLoaded={false} sessionsByJob={sessionsByJob} />);
    fireEvent.click(screen.getByText('Scheduled'));
    expect(screen.queryByText('Job deleted')).not.toBeInTheDocument();
  });
});
