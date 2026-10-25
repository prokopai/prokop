import type { AgentGroup, AgentGroupMember, AgentGroupMessage, Part } from '@prokopai/sdk';
import { mockId, mockIsoMinutesAgo, mockNow, merge } from './mockHelpers';

// =============================================================================
// Group chat factories
// =============================================================================

export const GROUP_MEMBERS: AgentGroupMember[] = [
  { agentId: 'implementer', name: 'Implementer', sessionId: 'sess-implementer', cursorSeq: 4, joinedAt: mockIsoMinutesAgo(90) },
  { agentId: 'reviewer', name: 'Reviewer', sessionId: 'sess-reviewer', cursorSeq: 6, joinedAt: mockIsoMinutesAgo(90) },
  { agentId: 'idea-architect', name: 'Idea Architect', sessionId: 'sess-architect', cursorSeq: 0, joinedAt: mockIsoMinutesAgo(20) },
];

export function createAgentGroup(overrides: Partial<AgentGroup> = {}): AgentGroup {
  return merge<AgentGroup>(
    {
      id: overrides.id ?? mockId('group'),
      workspaceId: 'ws-scene',
      name: 'API work',
      defaultAgentId: 'implementer',
      permissionMode: 'standard',
      members: GROUP_MEMBERS,
      createdAt: mockIsoMinutesAgo(90),
      updatedAt: mockIsoMinutesAgo(1),
    },
    overrides,
  );
}

let seq = 0;

function textPart(messageId: string, text: string): Part {
  return { id: mockId('part'), messageId, createdAt: mockNow(), type: 'text', text };
}

export function createAgentGroupMessage(overrides: Partial<AgentGroupMessage> & { text?: string } = {}): AgentGroupMessage {
  const id = overrides.id ?? mockId('gmsg');
  const { text, ...rest } = overrides;
  seq += 1;
  return merge<AgentGroupMessage>(
    {
      id,
      groupId: 'group-scene',
      seq,
      authorKind: 'user',
      authorAgentId: null,
      targetAgentId: null,
      sourceMessageId: null,
      parts: [textPart(id, text ?? 'Hello group')],
      hop: 0,
      createdAt: mockIsoMinutesAgo(Math.max(0, 30 - seq * 3)),
    },
    rest,
  );
}

/** A mirrored tool call: name, status and summary only, like the server stores it. */
export function createGroupToolPart(messageId: string, name: string, summary: string): Part {
  return {
    id: mockId('part'), messageId, createdAt: mockNow(), type: 'tool', callId: mockId('call'), name,
    state: { status: 'completed', input: {}, output: null, startedAt: mockNow() - 4_000, completedAt: mockNow() },
    presentation: { summary, debugAvailable: false },
  };
}

/** The thread from the plan: a request, an implementation with tool lines, a review, a handoff, a join. */
export function createGroupThread(groupId = 'group-scene'): AgentGroupMessage[] {
  seq = 0;
  const implementation = mockId('gmsg');
  return [
    createAgentGroupMessage({ groupId, text: '@Implementer add rate limiting to the API' }),
    createAgentGroupMessage({
      groupId, id: implementation, authorKind: 'agent', authorAgentId: 'implementer', sourceMessageId: mockId('msg'),
      parts: [
        createGroupToolPart(implementation, 'edit', 'edited middleware.ts'),
        createGroupToolPart(implementation, 'shell', 'bun test'),
        textPart(implementation, 'Done, token bucket in `middleware.ts`. Requests over the limit get a 429 with a Retry-After header.'),
      ],
    }),
    createAgentGroupMessage({ groupId, text: '@Reviewer check it' }),
    createAgentGroupMessage({ groupId, authorKind: 'agent', authorAgentId: 'reviewer', text: 'The bucket resets on restart. It should persist, otherwise a deploy clears every limit at once.' }),
    createAgentGroupMessage({ groupId, text: '@Implementer fix that, then hand it to Reviewer' }),
    createAgentGroupMessage({ groupId, authorKind: 'handoff', authorAgentId: 'implementer', targetAgentId: 'reviewer', hop: 1, text: 'Persisted in Redis with a 60 s TTL; please re-check middleware.ts and the new redis-bucket.test.ts.' }),
    createAgentGroupMessage({ groupId, authorKind: 'system', text: 'Idea Architect joined the group.' }),
  ];
}
