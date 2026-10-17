import { afterEach, describe, expect, test } from 'bun:test';
import type { Session, Workspace } from '@prokopai/sdk/types';
import {
  configureSessionSearchHost,
  executeSessionSearchTool,
  type SessionSearchHost,
} from '@prokopai/agent/internal/harnesses/shared/session-search/index';

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/workspace',
  isVirtual: false,
  additionalPaths: [],
  settings: {},
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const session = (id: string, workspaceId = workspace.id): Session => ({
  id,
  workspaceId,
  preconfigId: null,
  title: id,
  status: 'active',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  metadata: null,
  selectedModel: null,
  selectedProvider: null,
  selectedVariant: null,
  parentId: null,
  agentName: null,
  subagentStatus: null,
  runningAt: null,
  compacting: false,
  tags: [],
  autoApproveSeverity: null,
  agentId: null,
});

function searchHost(overrides: Partial<SessionSearchHost> = {}): SessionSearchHost {
  return {
    getWorkspace: async () => workspace,
    getSession: async (id) => session(id),
    listWorkspaceSessions: async () => [session('current'), session('other')],
    listAgentSessions: async () => [],
    countSessionMessages: async () => 2,
    searchMessages: async () => [],
    countMessagesBefore: async () => 0,
    countMessagesAfter: async () => 0,
    getLatestMessage: async () => null,
    getMessage: async () => null,
    listMessagesBefore: async () => [],
    listMessagesAfter: async () => [],
    getMessageSummary: async () => null,
    ...overrides,
  };
}

afterEach(() => {
  configureSessionSearchHost();
});

describe('session search host seam', () => {
  test('keeps list read-only and applies the existing default list limit', async () => {
    let asked = false;
    const sessions = Array.from({ length: 12 }, (_, index) => session(`session-${index}`));
    configureSessionSearchHost(searchHost({ listWorkspaceSessions: async () => sessions }));

    const result = await executeSessionSearchTool(
      { action: 'list' },
      workspace.id,
      'session-0',
      false,
      'high',
      async () => {
        asked = true;
        return false;
      },
    );

    expect(asked).toBe(false);
    expect(result.success).toBe(true);
    expect(result.sessions).toHaveLength(10);
  });

  test('passes search scope, roles, limits, and sort to the host', async () => {
    let received: Parameters<SessionSearchHost['searchMessages']>[0] | undefined;
    configureSessionSearchHost(searchHost({
      async searchMessages(options) {
        received = options;
        return [];
      },
    }));

    await executeSessionSearchTool(
      { query: 'needle', scope: 'current_session', limit: 99, roleFilter: ['tool'], sort: 'newest' },
      workspace.id,
      'current',
      false,
      'none',
    );

    expect(received).toEqual({
      query: 'needle',
      workspaceId: workspace.id,
      agentId: undefined,
      sessionId: 'current',
      roleFilter: ['tool'],
      limit: 20,
      sort: 'newest',
    });
  });

  test('rejects agent scope outside an agent session', async () => {
    let searched = false;
    configureSessionSearchHost(searchHost({
      async searchMessages() {
        searched = true;
        return [];
      },
    }));

    const searchResult = await executeSessionSearchTool(
      { query: 'secret', scope: 'agent' },
      workspace.id,
      'current',
      false,
      'none',
    );
    const listResult = await executeSessionSearchTool(
      { action: 'list', scope: 'agent' },
      workspace.id,
      'current',
      false,
      'none',
    );

    expect(searchResult.success).toBe(false);
    expect(searchResult.error).toContain('agent session');
    expect(listResult.success).toBe(false);
    expect(listResult.mode).toBe('list');
    expect(listResult.error).toContain('agent session');
    expect(searched).toBe(false);
  });

  test('reads around the latest message and bounds content', async () => {
    configureSessionSearchHost(searchHost({
      getLatestMessage: async () => ({ id: 'message-2', timestamp: 2 }),
      listMessagesBefore: async () => [{ id: 'message-1', role: 'user', timestamp: 1 }],
      getMessageSummary: async (id) => ({
        role: id === 'message-1' ? 'user' : 'assistant',
        timestamp: id === 'message-1' ? 1 : 2,
        content: 'x'.repeat(2100),
        toolName: '',
      }),
      countMessagesBefore: async () => 1,
    }));

    const result = await executeSessionSearchTool(
      { sessionId: 'other', window: 4 },
      workspace.id,
      'current',
      false,
      'none',
    );

    expect(result.success).toBe(true);
    expect(result.anchorInferred).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages?.[0]?.content.length).toBe(2003);
  });
});

