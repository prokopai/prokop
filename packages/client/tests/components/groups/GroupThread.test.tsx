import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render as renderBare, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AgentGroupMember, AgentGroupMessage, Part } from '@prokopai/sdk';
import type { DisplayItem } from '@/components/chat/VirtualizedTranscript';
import { GroupThread, groupDisplayItems } from '@/components/groups/GroupThread';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

// The list itself is virtual; the rows are what the person reads.
vi.mock('@legendapp/list/react', () => ({
  LegendList: (props: { data: DisplayItem[]; renderItem: (props: { item: DisplayItem }) => ReactNode; ListEmptyComponent?: () => ReactNode }) =>
    props.data.length === 0 && props.ListEmptyComponent
      ? <>{props.ListEmptyComponent()}</>
      : <>{props.data.map((item) => <div key={item.message.id}>{props.renderItem({ item })}</div>)}</>,
}));
vi.mock('@/components/shared/MarkdownRenderer', () => ({ MarkdownRenderer: ({ children }: { children: ReactNode }) => <>{children}</> }));

afterEach(cleanup);

/** Tool rows read the server context and the query client, like in the app. */
function render(element: ReactElement) {
  return renderBare(
    <QueryClientProvider client={new QueryClient()}>
      <ServerClientProvider value={{ sdkClient: null, serverUrl: 'http://localhost', apiToken: null, connected: true }}>
        <div style={{ height: 600 }}>{element}</div>
      </ServerClientProvider>
    </QueryClientProvider>,
  );
}

const members: AgentGroupMember[] = [
  { agentId: 'implementer', name: 'Implementer', sessionId: 'sess-implementer', cursorSeq: 0, joinedAt: '' },
  { agentId: 'reviewer', name: 'Reviewer', sessionId: 'sess-reviewer', cursorSeq: 0, joinedAt: '' },
];

let seq = 0;
function message(kind: AgentGroupMessage['authorKind'], text: string, extra: Partial<AgentGroupMessage> = {}, parts: Part[] = []): AgentGroupMessage {
  seq += 1;
  const id = `m${seq}`;
  return {
    id, groupId: 'g1', seq, authorKind: kind, authorAgentId: null, targetAgentId: null, sourceMessageId: null, hop: 0, createdAt: '2026-10-23T10:00:00.000Z',
    parts: [...parts, { id: `${id}-t`, messageId: id, createdAt: 1, type: 'text', text }], ...extra,
  };
}
const toolPart = (messageId: string, name: string, summary: string): Part => ({
  id: `${messageId}-${name}`, messageId, createdAt: 1, type: 'tool', callId: `c-${name}`, name,
  state: { status: 'completed', input: {}, output: null, startedAt: 1, completedAt: 2 }, presentation: { summary, debugAvailable: false },
});

test('the thread reads like a chat: your posts as prompts, members as named turns, handoffs and joins as event rows', () => {
  const reply = message('agent', 'Done, token bucket in middleware.ts.', { authorAgentId: 'implementer' });
  reply.parts.unshift(toolPart(reply.id, 'edit', 'edited middleware.ts'));
  const messages = [
    message('user', '@Implementer add rate limiting'),
    reply,
    message('handoff', 'Please review middleware.ts', { authorAgentId: 'implementer', targetAgentId: 'reviewer', hop: 1 }),
    message('system', 'Idea Architect joined the group.'),
    message('agent', 'Looks right.', { authorAgentId: 'tester' }),
  ];
  const items = groupDisplayItems('g1', messages, members, []);
  expect(items.map((item) => item.message.role)).toEqual(['user', 'assistant', 'user', 'user', 'assistant']);
  // A member's turn carries that member's session, so its tool rows open there.
  expect(items[1]!.message.sessionId).toBe('sess-implementer');
  expect(items[1]!.author).toMatchObject({ name: 'Implementer' });
  expect(items[4]!.author).toMatchObject({ name: 'tester' });

  render(<GroupThread groupId="g1" members={members} messages={messages} />);
  expect(screen.getByText('@Implementer add rate limiting')).toBeInTheDocument();
  const authors = screen.getAllByText(/./, { selector: '[data-message-author]' }).map((node) => node.textContent);
  expect(authors).toEqual(['Implementer', 'tester']);
  expect(screen.getByText('Done, token bucket in middleware.ts.')).toBeInTheDocument();
  expect(screen.getByText('edited middleware.ts')).toBeInTheDocument();
  const events = screen.getAllByRole('status');
  expect(events).toHaveLength(2);
  expect(events[0]).toHaveTextContent('Implementer → Reviewer');
  expect(events[0]).toHaveTextContent('handoff');
  expect(events[0]).toHaveTextContent('Please review middleware.ts');
  expect(events[1]).toHaveTextContent('Idea Architect joined the group.');
  // Nothing a person can revert or edit: these are not this session's prompts.
  expect(screen.queryByTitle('Edit message')).not.toBeInTheDocument();
});

test('an empty thread says so', () => {
  render(<GroupThread groupId="g1" members={members} messages={[]} />);
  expect(screen.getByText(/Nothing has been said yet/)).toBeInTheDocument();
});

test('a reply being written shows under the thread as that member, with its parts so far', () => {
  render(
    <GroupThread
      groupId="g1"
      members={members}
      messages={[message('user', '@Reviewer check it')]}
      live={[{
        member: members[1]!,
        message: { id: 'a-live', sessionId: 'sess-reviewer', role: 'assistant', status: 'streaming', modelId: 'm', providerId: 'p', tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: 1 },
        parts: [toolPart('a-live', 'read-file', 'middleware.ts'), { id: 'lt', messageId: 'a-live', createdAt: 1, type: 'text', text: 'Reading the bucket code' }],
      }]}
    />,
  );
  expect(screen.getByText('Reviewer', { selector: '[data-message-author]' })).toBeInTheDocument();
  expect(screen.getByText('middleware.ts')).toBeInTheDocument();
  expect(screen.getByText(/Reading the bucket code/)).toBeInTheDocument();
});

test('a reply reads ahead of the handoff its turn posted, with its handoff row, though the server stored it after', () => {
  const ask = message('user', '@Reviewer review it, then hand it on');
  const handoff = message('handoff', 'Fix the TTL in middleware.ts', { authorAgentId: 'reviewer', targetAgentId: 'implementer', sourceMessageId: 'a1', hop: 1 });
  const fix = message('agent', 'Fixing the TTL now.', { authorAgentId: 'implementer', hop: 1 });
  const verdict = message('agent', 'One fix needed, Implementer has it.', { authorAgentId: 'reviewer', sourceMessageId: 'a1' });
  verdict.parts.unshift(toolPart(verdict.id, 'handoff_to_agent', 'handed the TTL fix on'));
  const items = groupDisplayItems('g1', [ask, handoff, fix, verdict], members, []);
  expect(items.map((item) => item.message.id)).toEqual([ask.id, verdict.id, handoff.id, fix.id]);

  render(<GroupThread groupId="g1" members={members} messages={[ask, handoff, fix, verdict]} />);
  const reply = screen.getByText('One fix needed, Implementer has it.');
  const handoffRow = screen.getByRole('status');
  const handoffTool = screen.getByText('handed the TTL fix on');
  // DOCUMENT_POSITION_FOLLOWING: the second node comes after the first.
  expect(handoffTool.compareDocumentPosition(handoffRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reply.compareDocumentPosition(handoffRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(handoffRow.compareDocumentPosition(screen.getByText('Fixing the TTL now.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('a reply being written sits where it will land: ahead of its turn\'s handoff, else at the end', () => {
  const ask = message('user', '@Reviewer review it, then hand it on');
  const handoff = message('handoff', 'Fix the TTL in middleware.ts', { authorAgentId: 'reviewer', targetAgentId: 'implementer', sourceMessageId: 'a1', hop: 1 });
  const fix = message('agent', 'Fixing the TTL now.', { authorAgentId: 'implementer', hop: 1 });
  const streaming = (id: string, member: AgentGroupMember) => ({
    member,
    message: { id, sessionId: member.sessionId, role: 'assistant' as const, status: 'streaming' as const, modelId: 'm', providerId: 'p', tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: 1 },
    parts: [{ id: `${id}-t`, messageId: id, createdAt: 1, type: 'text' as const, text: 'Still writing' }],
  });
  const live = groupDisplayItems('g1', [ask, handoff, fix], members, [streaming('a1', members[1]!), streaming('a2', members[0]!)]);
  expect(live.map((item) => item.message.id)).toEqual([ask.id, 'a1', handoff.id, fix.id, 'a2']);
  expect(live[1]!.author).toMatchObject({ name: 'Reviewer' });

  // The finished reply takes the preview's place, so nothing moves.
  const verdict = message('agent', 'One fix needed.', { authorAgentId: 'reviewer', sourceMessageId: 'a1' });
  const finished = groupDisplayItems('g1', [ask, handoff, fix, verdict], members, []);
  expect(finished.findIndex((item) => item.message.id === verdict.id)).toBe(1);
});

test("a member's approval sits under the thread, labeled with the member, and is answered from here", () => {
  const onAskResponse = vi.fn();
  render(
    <GroupThread
      groupId="g1"
      members={members}
      messages={[message('user', '@Reviewer run the tests')]}
      asks={[{
        member: members[1]!,
        request: {
          toolCallId: 'call-1', sessionId: 'sess-reviewer', toolName: 'shell', requestId: 'req-1',
          ask: { type: 'permission', question: 'Run `bun test`?', risk: 'medium', scope: { kind: 'tool', tool: 'shell' } } as never,
        },
      }]}
      onAskResponse={onAskResponse}
    />,
  );
  const card = document.querySelector('[data-group-ask="reviewer"]')!;
  expect(card).toHaveTextContent('Reviewer needs you');
  expect(card).toHaveTextContent('Run `bun test`?');
  const buttons = within(card as HTMLElement).getAllByRole('button');
  fireEvent.click(buttons[0]!);
  expect(onAskResponse).toHaveBeenCalledWith('call-1', expect.objectContaining({ type: 'permission' }), 'req-1');
});
