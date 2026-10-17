import type { ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@prokopai/core/application/ports/delivery';
import type { SessionExecutionPort } from '@prokopai/core/application/ports/execution';
import type { SessionRepositoryPort } from '@prokopai/core/application/ports/session';
import type { ShellCompletionPort } from '@prokopai/agent';
import type { ConnectionId } from '@/transport/websocket/connection-id';

export interface ShellCompletionDeliveryDeps {
  runtime: {
    configureShellCompletions(port: ShellCompletionPort | null): void;
    killShellCommandsForSession(sessionId: string): Promise<void>;
  };
  repository: Pick<SessionRepositoryPort, 'getSession' | 'addMessageToQueue'>;
  execution: Pick<SessionExecutionPort, 'isSessionActive' | 'sendMessage'>;
  /** Session-wide delivery; a background origin has no connection to answer. */
  delivery: {
    broadcast(message: ServerMessage): void;
    broadcastToSession(sessionId: string, message: ServerMessage): void;
    sendToController(sessionId: string, message: ServerMessage): void;
    sendToAskTargets: SessionWirePorts<ConnectionId>['delivery']['sendToAskTargets'];
  };
}

export interface ShellCompletionDelivery {
  /** The port installed into the agent runtime. */
  port: ShellCompletionPort;
  /** Kills the session's background commands; archive, delete, undo and edit call it. */
  stopBackgroundWork(sessionId: string): void;
}

/**
 * Host side of background shell completions. A finished command becomes a
 * prompt in its session: steered into the running turn (the queue row the
 * Prokop turn picks up at its next step boundary, or drains after it), or a
 * new turn when the session is idle. Everything a turn broadcasts still
 * reaches the session's clients; replies to the origin have no one to go to.
 */
export function installShellCompletionDelivery(deps: ShellCompletionDeliveryDeps): ShellCompletionDelivery {
  const wire: SessionWirePorts<ConnectionId> = {
    delivery: {
      send: () => {},
      broadcast: (message) => deps.delivery.broadcast(message),
      broadcastToSession: (sessionId, message) => deps.delivery.broadcastToSession(sessionId, message),
      sendToController: (sessionId, message) => deps.delivery.sendToController(sessionId, message),
      sendToAskTargets: (sessionId, authority, message) => deps.delivery.sendToAskTargets(sessionId, authority, message),
    },
    actor: { attachOriginToSession: () => {} },
  };

  const port: ShellCompletionPort = {
    async deliver(sessionId, content) {
      const session = deps.repository.getSession(sessionId);
      // Only a live top-level Prokop session can take a new prompt; a child
      // session's turn reads its command instead.
      if (!session || session.harness !== 'prokop' || session.status !== 'active' || session.parentId) return;
      if (deps.execution.isSessionActive(sessionId)) {
        const queued = deps.repository.addMessageToQueue(sessionId, content, undefined, true);
        deps.delivery.broadcastToSession(sessionId, { type: 'queue.added', sessionId, message: queued });
        return;
      }
      await deps.execution.sendMessage(wire, `shell:${sessionId}` as ConnectionId, sessionId, content);
    },
  };
  deps.runtime.configureShellCompletions(port);

  return {
    port,
    stopBackgroundWork(sessionId) {
      void deps.runtime.killShellCommandsForSession(sessionId).catch(() => {});
    },
  };
}
