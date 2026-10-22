import { describe, expect, test } from 'bun:test';
import type { AskAuthority, ServerMessage } from '@prokopai/sdk';
import { routeChildAsksToRoot } from '@/transport/websocket/child-asks';
import type { DeliveryPort } from '@/transport/websocket/delivery';

const authority: AskAuthority = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' };

function harness() {
  const sent: Array<{ via: string; sessionId: string; message: ServerMessage }> = [];
  const inner: DeliveryPort = {
    sendToConnection: () => {},
    broadcast: () => {},
    broadcastToSession: () => {},
    sendToController: (sessionId, message) => sent.push({ via: 'controller', sessionId, message }),
    sendToAskTargets: (sessionId, _authority, message) => sent.push({ via: 'asks', sessionId, message }),
  };
  const parents: Record<string, string | null> = { root: null, child: 'root', grandchild: 'child' };
  const routed = routeChildAsksToRoot(inner, (id) => (id in parents ? { id, parentId: parents[id] } : null));
  return { routed, sent };
}

describe('child asks reach the root session', () => {
  test('a child ask is rewritten to the root with the child as its origin', () => {
    const { routed, sent } = harness();
    const ask = { type: 'ask.request', sessionId: 'grandchild', toolCallId: 'c', toolName: 'shell', ask: { type: 'permission' } } as unknown as ServerMessage;

    routed.sendToAskTargets('grandchild', authority, ask);

    expect(sent).toEqual([{
      via: 'asks',
      sessionId: 'root',
      message: expect.objectContaining({ sessionId: 'root', ask: { type: 'permission', _originSessionId: 'grandchild' } }),
    }]);
  });

  test('a timeout follows the same route; an already rewritten or root ask passes through', () => {
    const { routed, sent } = harness();
    routed.sendToController('child', { type: 'ask.timeout', sessionId: 'child', toolCallId: 'c' } as ServerMessage);
    expect(sent[0]).toMatchObject({ via: 'controller', sessionId: 'root', message: { sessionId: 'root' } });

    const prokopStyle = { type: 'ask.request', sessionId: 'root', toolCallId: 'c', toolName: 't', ask: { _originSessionId: 'child' } } as unknown as ServerMessage;
    routed.sendToAskTargets('root', authority, prokopStyle);
    expect(sent[1]).toMatchObject({ sessionId: 'root', message: prokopStyle });

    routed.sendToAskTargets('root', authority, { type: 'ask.request', sessionId: 'root', toolCallId: 'c', toolName: 't', ask: { type: 'q' } } as unknown as ServerMessage);
    expect(sent[2]).toMatchObject({ sessionId: 'root', message: { ask: { type: 'q' } } });

    // Other messages are untouched, child or not.
    routed.sendToController('child', { type: 'queue.removed', sessionId: 'child', queueId: 'q' });
    expect(sent[3]).toMatchObject({ sessionId: 'child', message: { type: 'queue.removed' } });
  });
});
