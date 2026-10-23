import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session, ToolPart } from '@prokopai/sdk';
import { ToolCall } from '@/components/chat/ToolCall';
import { ServerClientProvider } from '@/contexts/ServerClientContext';
import { useAskStore } from '@/stores/askStore';
import { useSessionStore } from '@/stores/sessionStore';

const CONVERSATION_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';

afterEach(() => {
  cleanup();
  useSessionStore.getState().clearSessions();
  useAskStore.getState().clearPendingRequests();
});

function messagePart(): ToolPart {
  return {
    id: 'part-1', messageId: 'message-1', createdAt: 1, type: 'tool', callId: 'call-1', name: 'message_agent',
    state: {
      status: 'completed', startedAt: 1, completedAt: 2,
      input: { agent_id: 'marketing', message: 'Brand colors?', intent: 'question' },
      output: JSON.stringify({ delivered: true, conversation_session_id: CONVERSATION_ID, intent: 'question', hop: 1 }),
    },
    presentation: { summary: 'marketing: Brand colors?', visualization: { type: 'none', badge: 'question', message: 'To marketing: Brand colors?' }, debugAvailable: false },
  };
}

function renderRow(onNavigateToSubagent = vi.fn()) {
  const sdkClient = { http: { tools: { list: async () => ({ tools: [] }) } } } as unknown as ProkopaiClient;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerClientProvider value={{ sdkClient, serverUrl: 'http://localhost', apiToken: null, connected: true }}>
        <ToolCall sessionId="session-1" part={messagePart()} onNavigateToSubagent={onNavigateToSubagent} />
      </ServerClientProvider>
    </QueryClientProvider>,
  );
  return onNavigateToSubagent;
}

test('a sent message links to the conversation and shows its intent', () => {
  const onNavigateToSubagent = renderRow();
  expect(screen.getByText('question')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View session' }));
  expect(onNavigateToSubagent).toHaveBeenCalledWith(CONVERSATION_ID);
});

test('the row follows the conversation: working while it runs, needs you while it asks', () => {
  renderRow();
  expect(screen.queryByText('working')).not.toBeInTheDocument();
  act(() => useSessionStore.getState().setSessions([{ id: CONVERSATION_ID, workspaceId: 'marketing-home', title: 'From Coding',
    status: 'active', parentId: null, runningAt: new Date().toISOString() } as Session]));
  expect(screen.getByText('working')).toBeInTheDocument();
  act(() => useAskStore.getState().addPendingRequest({ sessionId: CONVERSATION_ID, toolCallId: 'ask-1', toolName: 'shell',
    ask: { type: 'permission', question: 'Run it?', resource: 'shell-command', action: 'execute', risk: 'medium' } }));
  expect(screen.getByText('needs you')).toBeInTheDocument();
  expect(screen.queryByText('working')).not.toBeInTheDocument();
});
