import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Session, SessionHarnessState } from '@prokopai/sdk';
import { ChatView } from '@/components/chat/ChatView';

vi.mock('@/components/chat/DeferredConversation', () => ({
  DeferredConversation: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/chat/VirtualizedTranscript', () => ({ VirtualizedTranscript: () => <div data-testid="transcript" /> }));
vi.mock('@/components/chat/MessageInput', () => ({ MessageInput: () => <input aria-label="message" /> }));
vi.mock('@/components/chat/EmptySessionCheckout', () => ({ EmptySessionCheckout: () => null }));
vi.mock('@/components/chat/RetryStatus', () => ({ RetryStatus: () => null }));
vi.mock('@/hooks/useTranscriptPagination', () => ({ useTranscriptPagination: () => ({ loadOlder: () => {} }) }));
afterEach(cleanup);

function child(overrides: { canInterrupt: boolean; status: Session['subagentStatus']; isStopping?: boolean; onInterrupt?: () => void }) {
  const harnessState: SessionHarnessState = {
    compaction: { pending: false, uncertain: false, boundaryMessageId: null },
    fork: { mode: 'any' }, goal: null, usage: null, goalUncertain: false,
    capabilities: { canRemoveQueuedMessages: true, canSteerQueuedMessages: true,
      canInterruptSubagent: overrides.canInterrupt, subagentActivityPropagates: false },
  };
  const session: Session = { id: 'child', workspaceId: 'ws', status: 'active', harness: 'prokop', parentId: 'root',
    preconfigId: 'explore', title: 'Explore (@explore subagent)', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    agentName: 'explore', metadata: { delegatedChild: true }, subagentStatus: overrides.status, harnessState };
  return <ChatView session={session} messagesWithParts={[]} queuedMessages={[]}
    pendingAskRequests={[]} onAskResponse={() => {}} onRemoveFromQueue={() => {}}
    onSendMessage={() => {}} onInterrupt={overrides.onInterrupt} isStopping={overrides.isStopping} />;
}

test('a running subagent gets a Stop control instead of the composer', () => {
  const onInterrupt = vi.fn();
  render(child({ canInterrupt: true, status: 'running', onInterrupt }));
  expect(screen.queryByRole('textbox', { name: 'message' })).not.toBeInTheDocument();
  expect(screen.getByText('Subagent is working')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stop subagent' }));
  expect(onInterrupt).toHaveBeenCalledTimes(1);
});

test('after Stop the control waits for the server', () => {
  render(child({ canInterrupt: true, status: 'running', isStopping: true, onInterrupt: vi.fn() }));
  expect(screen.getByText('Stopping the subagent…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stop subagent' })).toBeDisabled();
});

test('a finished subagent and a native agent thread show the read-only note', () => {
  const finished = render(child({ canInterrupt: true, status: 'completed', onInterrupt: vi.fn() }));
  expect(screen.getByText(/read-only/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop subagent' })).not.toBeInTheDocument();
  finished.unmount();

  render(child({ canInterrupt: false, status: 'running', onInterrupt: vi.fn() }));
  expect(screen.getByText(/read-only/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop subagent' })).not.toBeInTheDocument();
});
