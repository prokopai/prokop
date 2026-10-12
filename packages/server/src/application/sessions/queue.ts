import type { SessionWirePorts } from '@/application/ports/delivery';
import type { ControllerGatePort } from '@/application/ports/control';
import type { SessionRepositoryPort } from '@/application/ports/session';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { sendGateRejection } from './chat';
import { unknownHarnessError } from './harness-policy';
import { clientSends, type ClientSendRegistry } from './client-sends';

export interface SessionQueueDeps<Origin> {
  repository: SessionRepositoryPort;
  gate: ControllerGatePort<Origin>;
  execution?: Pick<SessionExecutionPort, 'drainQueue' | 'steerQueue'>;
  /** Defaults to the process-wide registry shared with direct sends. */
  sends?: ClientSendRegistry;
}

export interface SessionQueueApplication<Origin> {
  add(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: {
      sessionId: string;
      content: string;
      attachments?: Array<{ id: string; kind: string }>;
      clientMessageId?: string;
      steer?: boolean;
    },
  ): void;
  remove(wire: SessionWirePorts<Origin>, origin: Origin, queueId: string): void;
  /** Marks a queued message for delivery into the running turn and wakes the runtime. */
  steer(wire: SessionWirePorts<Origin>, origin: Origin, queueId: string): void;
}

export function createSessionQueueApplication<Origin>(
  deps: SessionQueueDeps<Origin>,
): SessionQueueApplication<Origin> {
  const sends = deps.sends ?? clientSends;

  function addTracked(wire: SessionWirePorts<Origin>, origin: Origin, input: Parameters<SessionQueueApplication<Origin>['add']>[2]): void {
    const sessionId = input.sessionId;
    const session = deps.repository.getSession(sessionId);
    if (!session) {
      wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found' });
      return;
    }
    const featureError = unknownHarnessError(session.harness);
    if (featureError) {
      wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: featureError, sessionId });
      return;
    }
    const gate = deps.gate.checkControllerGate(sessionId, 'queue.add', origin);
    if (gate) {
      sendGateRejection(wire, origin, gate);
      return;
    }

    const cli = session.harness === 'codex-cli' || session.harness === 'claude-cli';
    if (cli && (session.parentId || session.status !== 'active' || session.compacting)) {
      wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Session cannot accept queued messages', sessionId });
      return;
    }
    if (cli && input.attachments?.length) {
      const records = deps.repository.attachments.listForSession(sessionId);
      if (session.harness === 'claude-cli' && input.attachments.length > 10 || input.attachments.some(attachment =>
        attachment.kind !== 'image' || !records.some(record => record.id === attachment.id
          && record.kind === 'image' && record.workspaceId === session.workspaceId
          && deps.repository.attachments.validateImageMime(record.mimeType)))) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_content', message: 'CLI queues support session image attachments only', sessionId });
        return;
      }
    }
    if (!input.content?.trim() && !(cli && input.attachments?.length)) {
      wire.delivery.send(origin, { type: 'error', code: 'invalid_content', message: 'Content cannot be empty' });
      return;
    }

    const queuedMessage = deps.repository.addMessageToQueue(sessionId, input.content, input.attachments, input.steer === true);
    wire.actor.attachOriginToSession(origin, sessionId);

    wire.delivery.send(origin, {
      type: 'queue.added',
      sessionId,
      message: queuedMessage,
    });
    // A client's running state may lag behind turn completion. Wake idle queues too.
    if (cli) void deps.execution?.drainQueue?.(wire, origin, sessionId).catch(() => {
      wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId,
        message: 'Queued message could not be sent' });
    });
    if (queuedMessage.steer) wakeSteering(wire, origin, sessionId);
  }

  /** Prokop checks for steer messages at each step boundary; CLI runs need a wake-up. */
  function wakeSteering(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): void {
    void deps.execution?.steerQueue?.(wire, origin, sessionId).catch(() => {
      wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId,
        message: 'Steering message could not be delivered; it stays queued' });
    });
  }

  return {
    add(wire, origin, input): void {
      const tracked = sends.track(wire, origin, input.sessionId, input.clientMessageId);
      if (!tracked) return;
      try {
        addTracked(tracked.wire, origin, input);
      } finally {
        tracked.finish();
      }
    },

    remove(wire, origin, queueId): void {
      const queuedMsg = deps.repository.getQueuedMessage(queueId);
      if (!queuedMsg) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Queued message not found' });
        return;
      }
      const gate = deps.gate.checkControllerGate(queuedMsg.sessionId, 'queue.remove', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }

      deps.repository.deleteQueuedMessage(queueId);

      wire.delivery.send(origin, {
        type: 'queue.removed',
        sessionId: queuedMsg.sessionId,
        queueId,
      });
    },

    steer(wire, origin, queueId): void {
      const queuedMsg = deps.repository.getQueuedMessage(queueId);
      if (!queuedMsg) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Queued message not found' });
        return;
      }
      const gate = deps.gate.checkControllerGate(queuedMsg.sessionId, 'queue.steer', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }
      const session = deps.repository.getSession(queuedMsg.sessionId);
      if (session?.harnessState?.capabilities.canSteerQueuedMessages === false) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId: queuedMsg.sessionId,
          message: 'This session cannot steer queued messages' });
        return;
      }
      const updated = queuedMsg.steer ? queuedMsg : deps.repository.markQueuedMessageSteer(queueId);
      if (!updated) {
        // Delivered or removed between the read and the update.
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Queued message not found' });
        return;
      }
      wire.delivery.broadcastToSession(updated.sessionId, { type: 'queue.updated', sessionId: updated.sessionId, message: updated });
      wakeSteering(wire, origin, updated.sessionId);
    },
  };
}
