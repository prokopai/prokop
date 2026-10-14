import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { getStorage } from '@/infrastructure/storage/runtime';
import { describeError, logHarness, type HarnessName } from './diagnostics';

/** Persists and announces whether a CLI session is busy. */
export type CliRunningFlag = <Origin>(wire: SessionWirePorts<Origin>, sessionId: string, running: boolean) => void | Promise<void>;

/**
 * Only Čapek runs wrote `runningAt`, so CLI turns looked idle to session
 * lists loaded on another device, to worktree removal guards, and to the
 * learning idle check. The update goes to every client, not only those
 * with the session open, because session lists read it.
 */
export const persistCliSessionRunning: CliRunningFlag = async (wire, sessionId, running) => {
  const updated = await getStorage().conversation.updateSession(sessionId,
    { runningAt: running ? new Date().toISOString() : null });
  if (updated) wire.delivery.broadcast({ type: 'session.updated', session: updated });
};

export interface QueuedTurnInput {
  isPending(): Promise<boolean>;
  /** Retires the queue row; await it before continuing the turn. */
  accepted(): Promise<void>;
}

export type QueuedCliExecution = Pick<SessionExecutionPort,
  'sendMessage' | 'drainQueue' | 'steerQueue' | 'interruptSession' | 'isSessionActive' | 'editMessage' | 'revert' | 'fork' | 'compact'>;

export interface CliTurnExecution extends Omit<QueuedCliExecution, 'sendMessage' | 'drainQueue' | 'steerQueue'> {
  sendMessage<Origin>(
    wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string,
    content: string, attachments?: Array<{ id: string; kind: string }>, responseFormatId?: string,
    goalCondition?: string, goalMaxTurns?: number, goalTokenBudget?: number,
    queued?: QueuedTurnInput,
    /** Called once the user message is persisted; rejected prompts never call it. Await it. */
    onTurnStarted?: () => Promise<void>,
  ): Promise<'drainable' | void>;
  /** Hands steer messages to the running turn. A session with no steerable turn leaves them queued. */
  steer?<Origin>(wire: SessionWirePorts<Origin>, sessionId: string): Promise<void>;
}

/**
 * Errors reach only the prompting connection, which may already be gone for
 * queued prompts. Every error a turn sends is also written to the server log.
 */
function loggedWire<Origin>(
  wire: SessionWirePorts<Origin>, harness: HarnessName, sessionId: string, queued: boolean,
): SessionWirePorts<Origin> {
  const delivery = wire.delivery;
  return {
    actor: wire.actor,
    delivery: {
      send(origin, message) {
        if (message.type === 'error') {
          logHarness(harness, queued ? 'queued prompt failed' : 'prompt failed',
            { sessionId: message.sessionId ?? sessionId, code: message.code, message: message.message });
        }
        delivery.send(origin, message);
      },
      broadcast: (message, excludeOrigin) => delivery.broadcast(message, excludeOrigin),
      broadcastToSession: (id, message, excludeOrigin) => delivery.broadcastToSession(id, message, excludeOrigin),
      sendToController: (id, message) => delivery.sendToController(id, message),
      sendToAskTargets: (id, authority, message) => delivery.sendToAskTargets(id, authority, message),
    },
  };
}

/**
 * CLI turns acknowledge persisted input and signal safe continuation only
 * after cleanup. The session is flagged running from its first started turn
 * until its queue is drained, so queued turns do not flicker idle in between.
 */
export function withCliMessageQueue(
  execution: CliTurnExecution, harness: HarnessName, markRunning: CliRunningFlag,
): QueuedCliExecution {
  const running = new Set<string>();
  const flagged = new Set<string>();
  /** Flag writes per session, in call order; the last one wins. */
  const flagWrites = new Map<string, Promise<void>>();

  function setRunning<Origin>(wire: SessionWirePorts<Origin>, sessionId: string, value: boolean): Promise<void> {
    const previous = flagWrites.get(sessionId) ?? Promise.resolve();
    if (value === flagged.has(sessionId)) return previous;
    if (value) flagged.add(sessionId);
    else flagged.delete(sessionId);
    const next = previous.then(() => markRunning(wire, sessionId, value)).catch((error: unknown) => {
      // The flag is presentation and guard state; never fail a turn over it.
      logHarness(harness, 'running flag update failed', { sessionId, running: value, ...describeError(error) });
    });
    flagWrites.set(sessionId, next);
    void next.then(() => { if (flagWrites.get(sessionId) === next) flagWrites.delete(sessionId); });
    return next;
  }

  async function send<Origin>(
    wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string, queued: boolean,
    content: string, attachments?: Array<{ id: string; kind: string }>, responseFormatId?: string,
    goalCondition?: string, goalMaxTurns?: number, goalTokenBudget?: number, queuedInput?: QueuedTurnInput,
  ): Promise<'drainable' | void> {
    try {
      return await execution.sendMessage(loggedWire(wire, harness, sessionId, queued), origin, sessionId, content,
        attachments, responseFormatId, goalCondition, goalMaxTurns, goalTokenBudget, queuedInput,
        () => setRunning(wire, sessionId, true));
    } catch (error) {
      logHarness(harness, 'turn threw', { sessionId, queued, ...describeError(error) });
      throw error;
    }
  }

  async function drain<Origin>(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): Promise<void> {
    const { conversation, queue } = getStorage();
    while ((await conversation.getSession(sessionId))?.status === 'active') {
      const next = await queue.peek(sessionId);
      if (!next) return;
      let accepted = false;
      const result = await send(wire, origin, sessionId, true, next.content, next.attachments,
        undefined, undefined, undefined, undefined, {
          isPending: async () => await queue.get(next.id) !== null
            && (await conversation.getSession(sessionId))?.status === 'active',
          accepted: async () => {
            accepted = true;
            // Input is already persisted. Never replay it if delivery subsequently fails.
            try {
              wire.delivery.broadcastToSession(sessionId, { type: 'queue.sending', sessionId, queueId: next.id });
            } finally {
              await queue.delete(next.id);
            }
          },
        });
      if (result !== 'drainable' || !accepted && await queue.get(next.id)) {
        if (await queue.get(next.id)) {
          logHarness(harness, 'queue stopped', { sessionId, queueId: next.id, accepted,
            reason: result === 'drainable' ? 'not accepted' : 'turn did not finish cleanly' });
        }
        return;
      }
    }
  }

  const queuedExecution: QueuedCliExecution = {
    ...execution,
    isSessionActive: sessionId => running.has(sessionId) || execution.isSessionActive(sessionId),
    async editMessage(wire, origin, input) {
      if (running.has(input.sessionId)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId: input.sessionId,
          message: 'CLI turn already running' });
        return;
      }
      await execution.editMessage.call(queuedExecution, wire, origin, input);
    },
    async compact(sessionId, reason, delivery) {
      if (running.has(sessionId)) return { ok: false, skipped: true, error: 'CLI turn already running' };
      return execution.compact(sessionId, reason, delivery);
    },
    async revert(input) {
      if (running.has(input.sessionId)) throw new Error('CLI turn already running');
      return execution.revert(input);
    },
    async fork(input) {
      if (running.has(input.sessionId)) throw new Error('CLI turn already running');
      return execution.fork(input);
    },
    async sendMessage(wire, origin, sessionId, ...input) {
      if (running.has(sessionId)) {
        loggedWire(wire, harness, sessionId, false).delivery.send(origin, { type: 'error', code: 'invalid_session',
          sessionId, message: 'CLI turn already running' });
        return;
      }
      running.add(sessionId);
      try {
        const result = await send(wire, origin, sessionId, false, ...input);
        if (result === 'drainable') await drain(wire, origin, sessionId);
      } finally {
        await setRunning(wire, sessionId, false);
        running.delete(sessionId);
      }
    },
    async steerQueue(wire, _origin, sessionId) {
      await execution.steer?.(wire, sessionId);
    },
    async drainQueue(wire, origin, sessionId) {
      if (running.has(sessionId) || execution.isSessionActive(sessionId)) return;
      running.add(sessionId);
      try {
        await drain(wire, origin, sessionId);
      } finally {
        await setRunning(wire, sessionId, false);
        running.delete(sessionId);
      }
    },
  };
  return queuedExecution;
}
