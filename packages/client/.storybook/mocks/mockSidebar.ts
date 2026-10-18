// =============================================================================
// Sidebar, overview and terminal mock data
// =============================================================================

import type { Agent, PinnedMessage, ScheduledJob, Session } from '@prokopai/sdk';
import type { AttentionSnapshot } from '@prokopai/sdk';
import type { ChildrenMap, SessionDerivedValuesMap } from '@/components/layout/SessionMenuButton';
import type { TerminalTab } from '@/components/layout/TerminalTabStrip';
import { mockId, mockIsoHoursAgo, mockIsoMinutesAgo, merge } from './mockHelpers';
import { createSession } from './mockSession';

// -----------------------------------------------------------------------------
// Sessions for lists
// -----------------------------------------------------------------------------

/** A realistic workspace session list: titles, tags, states and a subagent tree. */
export function createSidebarSessions(workspaceId: string): { sessions: Session[]; childrenMap: ChildrenMap; derived: SessionDerivedValuesMap } {
  const streaming = createSession({ id: `${workspaceId}-s1`, workspaceId, title: 'Refactor the auth module', runningAt: mockIsoMinutesAgo(2), tags: ['auth'], updatedAt: mockIsoMinutesAgo(1) });
  const waiting = createSession({ id: `${workspaceId}-s2`, workspaceId, title: 'Deploy to staging', runningAt: mockIsoMinutesAgo(5), tags: ['ops'], updatedAt: mockIsoMinutesAgo(4) });
  const idle = createSession({ id: `${workspaceId}-s3`, workspaceId, title: 'Write README for the SDK package with a title long enough to truncate in the sidebar', tags: ['docs', 'auth'], updatedAt: mockIsoMinutesAgo(40) });
  const untitled = createSession({ id: `${workspaceId}-s4`, workspaceId, title: null, updatedAt: mockIsoHoursAgo(3) });
  const worktree = createSession({ id: `${workspaceId}-s5`, workspaceId, title: 'Fix flaky terminal resize test', workspaceRootId: 'wt-1', worktree: { id: 'wt-1', name: 'fix-terminal', branch: 'fix/terminal-resize', path: '/home/user/.prokopai/worktrees/fix-terminal' } as Session['worktree'], updatedAt: mockIsoHoursAgo(5) });
  const parent = createSession({ id: `${workspaceId}-s6`, workspaceId, title: 'Explore the codebase', runningAt: mockIsoMinutesAgo(8), updatedAt: mockIsoMinutesAgo(8) });
  const child1 = createSession({ id: `${workspaceId}-s6a`, workspaceId, title: 'Subagent: map stores', parentId: parent.id, agentName: 'explore', subagentStatus: 'running', runningAt: mockIsoMinutesAgo(7) });
  const child2 = createSession({ id: `${workspaceId}-s6b`, workspaceId, title: 'Subagent: list routes', parentId: parent.id, agentName: 'explore', subagentStatus: 'completed' });
  const archived = createSession({ id: `${workspaceId}-s7`, workspaceId, title: 'Old migration work', status: 'closed', updatedAt: mockIsoHoursAgo(90) });
  const sessions = [streaming, waiting, idle, untitled, worktree, parent, child1, child2, archived];
  const childrenMap: ChildrenMap = new Map([[parent.id, [child1, child2]]]);
  const derived: SessionDerivedValuesMap = new Map([
    [streaming.id, { isStreaming: true, hasPendingPermission: false, isRunning: true }],
    [waiting.id, { isStreaming: false, hasPendingPermission: true, isRunning: true }],
    [parent.id, { isStreaming: false, hasPendingPermission: false, isRunning: true }],
    [child1.id, { isStreaming: true, hasPendingPermission: false, isRunning: true }],
  ]);
  return { sessions, childrenMap, derived };
}

export function groupByTag(sessions: Session[]): { tagGroups: Map<string, Session[]>; orderedTagNames: string[]; allTags: string[] } {
  const tagGroups = new Map<string, Session[]>();
  for (const session of sessions) {
    for (const tag of session.tags ?? []) {
      tagGroups.set(tag, [...(tagGroups.get(tag) ?? []), session]);
    }
  }
  const orderedTagNames = [...tagGroups.keys()].sort();
  return { tagGroups, orderedTagNames, allTags: orderedTagNames };
}

// -----------------------------------------------------------------------------
// Scheduled jobs
// -----------------------------------------------------------------------------

export function createScheduledJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const id = overrides.id ?? mockId('job');
  return merge<ScheduledJob>({
    id,
    workspaceId: 'ws-1',
    name: 'Nightly dependency audit',
    prompt: 'Run the dependency audit and summarize new advisories.',
    scheduleKind: 'daily',
    scheduleConfig: { type: 'daily', time: '02:00' },
    scheduleDisplay: 'Every day at 02:00',
    state: 'active',
    repeatLimit: null,
    runCount: 14,
    nextRunAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    lastRunAt: mockIsoHoursAgo(19),
    lastRunSessionId: null,
    lastError: null,
    reuseSession: false,
    includeHistory: false,
    preconfigId: null,
    originSessionId: null,
    notificationsEnabled: true,
    createdAt: mockIsoHoursAgo(300),
    updatedAt: mockIsoHoursAgo(19),
    harness: 'prokop',
  }, overrides);
}

export const scheduledJobPresets = {
  active: createScheduledJob({ id: 'job-active' }),
  soon: createScheduledJob({ id: 'job-soon', name: 'Hourly inbox triage', scheduleKind: 'interval', scheduleConfig: { type: 'interval', intervalMinutes: 60 }, scheduleDisplay: 'Every hour', nextRunAt: new Date(Date.now() + 4 * 60_000).toISOString(), runCount: 302 }),
  paused: createScheduledJob({ id: 'job-paused', name: 'Weekly changelog draft', scheduleKind: 'weekly', scheduleConfig: { type: 'weekly', days: [1], time: '09:00' }, scheduleDisplay: 'Mondays at 09:00', state: 'paused', nextRunAt: null }),
  failed: createScheduledJob({ id: 'job-failed', name: 'Sync translations', scheduleKind: 'interval', scheduleConfig: { type: 'interval', intervalMinutes: 360 }, scheduleDisplay: 'Every 6 hours', lastError: 'Provider returned 503 while starting the run.', nextRunAt: new Date(Date.now() - 60_000).toISOString() }),
  completed: createScheduledJob({ id: 'job-done', name: 'One-off migration check', scheduleKind: 'once', scheduleConfig: { type: 'once', runAt: mockIsoHoursAgo(48) }, scheduleDisplay: 'Once, 2 days ago', state: 'completed', repeatLimit: 1, runCount: 1, nextRunAt: null }),
} as const;

// -----------------------------------------------------------------------------
// Pinned messages
// -----------------------------------------------------------------------------

export function createPinnedMessage(overrides: Partial<PinnedMessage> = {}): PinnedMessage {
  return merge<PinnedMessage>({
    id: mockId('pin'),
    workspaceId: 'ws-1',
    sessionId: mockId('sess'),
    messageId: mockId('msg'),
    createdAt: Date.now() - 3_600_000,
    sessionTitle: 'Refactor the auth module',
    messageCreatedAt: Date.now() - 7_200_000,
    preview: 'The session helper accepts tokens without an exp claim; the fix adds the check and a regression test.',
  }, overrides);
}

// -----------------------------------------------------------------------------
// Agents
// -----------------------------------------------------------------------------

export function createAgent(overrides: Partial<Agent> = {}): Agent {
  return merge<Agent>({
    id: mockId('agent'),
    name: 'reviewer',
    description: 'Reviews pull requests and leaves findings.',
    systemPrompt: 'You review code.',
    tools: null,
    model: null,
    provider: null,
    settings: null,
    isDefault: false,
    hasHome: true,
    createdAt: mockIsoHoursAgo(400),
  }, overrides);
}

// -----------------------------------------------------------------------------
// Terminals
// -----------------------------------------------------------------------------

export function createTerminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  const id = overrides.serverSessionId ?? mockId('term');
  return merge<TerminalTab>({
    serverSessionId: id,
    title: 'zsh',
    status: 'connected',
    cwd: '/home/user/my-project',
    shell: '/bin/zsh',
    origin: 'user',
  }, overrides);
}

export function createTerminalTabs(): TerminalTab[] {
  return [
    createTerminalTab({ serverSessionId: 'term-1', title: 'zsh' }),
    createTerminalTab({ serverSessionId: 'term-2', title: 'bun run dev', status: 'connected' }),
    createTerminalTab({ serverSessionId: 'term-3', title: 'agent: bun test', origin: 'agent', ownerSessionId: 'sess-1', status: 'disconnected' }),
    createTerminalTab({ serverSessionId: 'term-4', title: 'exited shell', status: 'exited' }),
    createTerminalTab({ serverSessionId: 'term-5', title: 'connecting…', status: 'connecting' }),
  ];
}

// -----------------------------------------------------------------------------
// Attention from other machines
// -----------------------------------------------------------------------------

export function createAttentionSnapshot(overrides: Partial<AttentionSnapshot> = {}): AttentionSnapshot {
  return merge<AttentionSnapshot>({
    revision: 1,
    asks: [
      { id: 'ask-1', kind: 'approval', sessionId: 'remote-s1', sessionTitle: 'Deploy to staging', workspaceId: 'remote-ws', workspaceName: 'infra', toolName: 'shell', createdAt: Date.now() - 60_000 },
      { id: 'ask-2', kind: 'question', sessionId: 'remote-s2', sessionTitle: 'Plan the migration', workspaceId: 'remote-ws', workspaceName: 'infra', toolName: 'ask', createdAt: Date.now() - 120_000 },
    ],
    running: [
      { sessionId: 'remote-s3', sessionTitle: 'Long refactor', workspaceId: 'remote-ws2', workspaceName: 'app', runningAt: mockIsoMinutesAgo(9) },
    ],
  }, overrides);
}
