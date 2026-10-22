import type { ServerMessage, Session } from '@prokopai/sdk';
import type { DeliveryPort } from './delivery';

/**
 * Asks from a child session reach the root session's clients, the way the
 * Prokop subagent runner already rewrites them: the message carries the
 * root's id and names the child in `_originSessionId`, so the user sees and
 * answers it where they are. A CLI child (a delegated Claude CLI or Codex
 * CLI session) gets the same treatment here, with no harness change.
 */
export function routeChildAsksToRoot(
  delivery: DeliveryPort,
  getSession: (id: string) => Pick<Session, 'id' | 'parentId'> | null,
): DeliveryPort {
  const rootOf = (sessionId: string): string => {
    let current = sessionId;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const parent = getSession(current)?.parentId;
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const rewrite = (sessionId: string, message: ServerMessage): { sessionId: string; message: ServerMessage } => {
    if (message.type !== 'ask.request' && message.type !== 'ask.timeout') return { sessionId, message };
    if (message.sessionId !== sessionId) return { sessionId, message };
    const root = rootOf(sessionId);
    if (root === sessionId) return { sessionId, message };
    if (message.type === 'ask.request') {
      const ask = message.ask as unknown as Record<string, unknown>;
      const rewritten = { ...ask, _originSessionId: ask._originSessionId ?? sessionId } as unknown as typeof message.ask;
      return { sessionId: root, message: { ...message, sessionId: root, ask: rewritten } };
    }
    return { sessionId: root, message: { ...message, sessionId: root } };
  };
  return {
    ...delivery,
    sendToAskTargets(sessionId, authority, message) {
      const routed = rewrite(sessionId, message);
      delivery.sendToAskTargets(routed.sessionId, authority, routed.message);
    },
    sendToController(sessionId, message) {
      const routed = rewrite(sessionId, message);
      delivery.sendToController(routed.sessionId, routed.message);
    },
  };
}
