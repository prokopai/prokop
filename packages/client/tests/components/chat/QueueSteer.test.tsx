import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, QueuedMessage, Session, Workspace } from '@prokopai/sdk';

vi.mock('@tanstack/react-router', () => ({ useRouterState: () => '/server/studio/workspace' }));
vi.mock('@/lib/hostClientPool', () => ({ foreignClientFor: () => null }));

import { useSessionCommands } from '@/hooks/useSessionCommands';
import { handleQueueUpdated } from '@/handlers/serverMessage/permissionQueueHandlers';
import type { SessionHandlersContext } from '@/handlers/serverMessage';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionContentStore } from '@/stores/sessionContentStore';
import { useUIStore } from '@/stores/uiStore';

const workspace = { id: 'w', name: 'jean2', path: '/p' } as Workspace;
const running = { id: 's1', workspaceId: 'w', title: 'Running', status: 'active', runningAt: new Date().toISOString(),
  harnessState: { capabilities: { canSteerQueuedMessages: true } } } as unknown as Session;
const queued: QueuedMessage = { id: 'q1', sessionId: 's1', content: 'use tabs', position: 0, createdAt: 1 };

beforeEach(() => {
  useServerDataStore.setState({ serverId: 'studio', activeWorkspaceId: workspace.id, workspaces: [workspace] });
  useSessionStore.setState({ ...useSessionStore.getInitialState(), sessions: [running] });
  useSessionContentStore.setState({ ...useSessionContentStore.getInitialState(),
    queuedMessages: { s1: [queued, { ...queued, id: 'q2', content: 'then run tests', position: 1 }] } });
});
afterEach(cleanup);

function commandsFor(client: unknown, session: Session = running) {
  return renderHook(() => useSessionCommands({
    clientRef: { current: client as ProkopaiClient }, currentSession: session, sessions: [session],
    workspaces: [workspace], activeWorkspace: workspace, streamingSessionIds: new Set([session.id]), primaryPreconfigs: [],
    setActiveWorkspace: vi.fn(), removePendingAskRequest: vi.fn(), removePendingPermissionRequest: vi.fn(),
    clearPendingAskRequestsBySessionId: vi.fn(), clearStreamingSessions: vi.fn(), pendingSessionCreateRef: { current: null },
    partAppendRafRef: { current: null }, pendingPartAppendsRef: { current: new Map() },
    skipFinishSoundSessionIdsRef: { current: new Set() }, navigate: vi.fn(), serverId: 'studio', viewPath: '/workspace',
  })).result.current;
}

describe('follow-up setting', () => {
  afterEach(() => useUIStore.getState().setFollowUpMode('steer'));

  test('steer is the default, and the choice is kept on this device', () => {
    expect(useUIStore.getState().followUpMode).toBe('steer');
    useUIStore.getState().setFollowUpMode('queue');
    expect(localStorage.getItem('prokopai_follow_up_mode')).toBe('queue');
    expect(useUIStore.getState().followUpMode).toBe('queue');
  });

  test('a message sent while the agent works steers by default and queues when set to Queue', () => {
    const client = { connected: true, queue: { add: vi.fn() }, chat: { send: vi.fn() }, on: vi.fn(), off: vi.fn() };
    commandsFor(client).sendChatMessageForSession('s1', 'use tabs');
    expect(client.queue.add).toHaveBeenLastCalledWith('s1', 'use tabs', expect.objectContaining({ steer: true }));
    useUIStore.getState().setFollowUpMode('queue');
    commandsFor(client).sendChatMessageForSession('s1', 'after that');
    expect(client.queue.add).toHaveBeenLastCalledWith('s1', 'after that', expect.objectContaining({ steer: false }));
  });

  test('a session that cannot steer, or a server too old to say, always queues', () => {
    const client = { connected: true, queue: { add: vi.fn() }, chat: { send: vi.fn() }, on: vi.fn(), off: vi.fn() };
    const noSteer = { ...running, harnessState: { capabilities: { canSteerQueuedMessages: false } } } as unknown as Session;
    useSessionStore.setState({ sessions: [noSteer] });
    commandsFor(client, noSteer).sendChatMessageForSession('s1', 'later');
    expect(client.queue.add).toHaveBeenLastCalledWith('s1', 'later', expect.objectContaining({ steer: false }));
    const older = { ...running, harnessState: undefined } as Session;
    useSessionStore.setState({ sessions: [older] });
    commandsFor(client, older).sendChatMessageForSession('s1', 'older');
    expect(client.queue.add).toHaveBeenLastCalledWith('s1', 'older', expect.objectContaining({ steer: false }));
  });
});

describe('steering a queued message', () => {
  test('Steer asks the session that owns the message', () => {
    const client = { connected: true, queue: { steer: vi.fn() }, on: vi.fn(), off: vi.fn() };
    commandsFor(client).steerQueued('q1');
    expect(client.queue.steer).toHaveBeenCalledWith('q1');
  });

  test('queue.updated marks the row in place and keeps queue order', () => {
    const ctx = { addQueuedMessage: useSessionContentStore.getState().addQueuedMessage } as unknown as SessionHandlersContext;
    handleQueueUpdated({ type: 'queue.updated', sessionId: 's1', message: { ...queued, steer: true } }, ctx);
    expect(useSessionContentStore.getState().queuedMessages.s1!.map(row => [row.id, row.steer ?? false]))
      .toEqual([['q1', true], ['q2', false]]);
  });

  test('a queued bubble offers Steer, and a steering one says so without offering it again', () => {
    const onSteer = vi.fn();
    const message = { id: 'q1', sessionId: 's1', role: 'user' as const, createdAt: 1 };
    const { rerender } = render(<MessageBubble message={message} isQueued onSteer={onSteer} onRemove={vi.fn()}>use tabs</MessageBubble>);
    expect(screen.getByText('Pending')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }));
    expect(onSteer).toHaveBeenCalledOnce();
    rerender(<MessageBubble message={message} isQueued isSteering onRemove={vi.fn()}>use tabs</MessageBubble>);
    expect(screen.getByText('Steering')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Steer' })).toBeNull();
  });
});
