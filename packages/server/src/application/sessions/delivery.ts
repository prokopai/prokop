/**
 * Server-originated delivery to a session: the one way a task result, a
 * message from another agent, or a group catch-up reaches a session's
 * model (docs/plans/cross-harness-delegation.md, phase 0).
 *
 * - An idle session starts a turn with the message, broadcast to clients
 *   like a user send.
 * - A busy session takes it through its queue by the existing rules
 *   (a steer row enters the running turn, a plain row follows it).
 * - A session that cannot accept right now (compacting, not active) keeps
 *   the delivery pending; it is retried when the session's row changes to
 *   an idle, active, non-compacting state, and once at startup.
 * - A session that no longer exists drops the delivery, recorded.
 * - The key makes a retried call or a second pass deliver once.
 *
 * Unlike a client send, a CLI child session may receive a delivery: that is
 * the only way a CLI parent at depth 1 gets an async result.
 */

import type { ServerMessage, Session } from '@prokopai/sdk';
import type { SessionWirePorts } from '@prokopai/core/application/ports/delivery';
import type { SessionExecutionPort } from '@prokopai/core/application/ports/execution';
import type { SessionRepositoryPort } from '@prokopai/core/application/ports/session';

export type SessionDeliveryState = 'pending' | 'delivered' | 'dropped';

export interface SessionDeliveryRecord {
  key: string;
  sessionId: string;
  /** Who sends: `delegation`, `agent`, `group`, or another server feature. */
  origin: string;
  content: string;
  steer: boolean;
  state: SessionDeliveryState;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface SessionDeliveryRepositoryPort {
  get(key: string): SessionDeliveryRecord | null;
  /** False when the key already exists: the delivery was made before. */
  insert(record: SessionDeliveryRecord): boolean;
  update(key: string, patch: Partial<Pick<SessionDeliveryRecord, 'state' | 'attempts' | 'lastError' | 'deliveredAt'>>): void;
  listPending(sessionId?: string): SessionDeliveryRecord[];
}

export interface SessionDeliveryInput {
  sessionId: string;
  content: string;
  /** Idempotency key: a tool call id, `task-result:<id>`, `auto-outcome:<turn>`. */
  key: string;
  origin: string;
  /** Enter a running turn instead of following it. Default false. */
  steer?: boolean;
}

/**
 * `started`: a turn began with the message. `queued`: the session was busy
 * and the message sits in its queue. `pending`: the session cannot take it
 * yet; it is retried on the session's next idle update. `dropped`: the
 * session is gone. `duplicate`: the key was delivered or recorded before.
 */
export type SessionDeliveryOutcome = 'started' | 'queued' | 'pending' | 'dropped' | 'duplicate';

export interface SessionDeliveryApplication {
  deliver(input: SessionDeliveryInput): Promise<SessionDeliveryOutcome>;
  /** Retries the session's pending deliveries, oldest first. */
  retryPending(sessionId: string): Promise<void>;
  /** Startup: every pending delivery gets one attempt. */
  retryAll(): Promise<void>;
  /** Wire this to the session store's update notifications. */
  onSessionUpdated(session: Session): void;
}

export interface SessionDeliveryDeps<Origin> {
  repository: SessionDeliveryRepositoryPort;
  sessions: Pick<SessionRepositoryPort, 'getSession' | 'addMessageToQueue'>;
  execution: Pick<SessionExecutionPort, 'isSessionActive' | 'sendMessage' | 'drainQueue'>;
  /** Session-wide delivery; a server origin has no connection to answer. */
  delivery: {
    broadcast(message: ServerMessage): void;
    broadcastToSession(sessionId: string, message: ServerMessage): void;
    sendToController(sessionId: string, message: ServerMessage): void;
    sendToAskTargets: SessionWirePorts<Origin>['delivery']['sendToAskTargets'];
  };
  /** The origin a turn runs under for a delivery key. */
  originFor(key: string): Origin;
  now?: () => string;
}

/** After this many failed attempts a delivery is dropped rather than retried forever. */
const MAX_ATTEMPTS = 20;

function isBusyError(message: ServerMessage): boolean {
  if (message.type !== 'error') return false;
  return message.code === 'session_busy' || /already running/i.test(message.message ?? '');
}

export function createSessionDeliveryApplication<Origin>(deps: SessionDeliveryDeps<Origin>): SessionDeliveryApplication {
  const now = deps.now ?? (() => new Date().toISOString());
  /** Attempts per session run one at a time, in order. */
  const chains = new Map<string, Promise<unknown>>();

  function serialized<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = chains.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    chains.set(sessionId, current);
    void current.finally(() => {
      if (chains.get(sessionId) === current) chains.delete(sessionId);
    });
    return current;
  }

  function wireFor(key: string, onError: (message: ServerMessage) => void): SessionWirePorts<Origin> {
    return {
      delivery: {
        send: (_origin, message) => {
          if (message.type === 'error') onError(message);
        },
        broadcast: (message) => deps.delivery.broadcast(message),
        broadcastToSession: (sessionId, message) => deps.delivery.broadcastToSession(sessionId, message),
        sendToController: (sessionId, message) => deps.delivery.sendToController(sessionId, message),
        sendToAskTargets: (sessionId, authority, message) => deps.delivery.sendToAskTargets(sessionId, authority, message),
      },
      actor: { attachOriginToSession: () => {} },
    };
  }

  function queue(record: SessionDeliveryRecord, session: Session): 'queued' {
    const queued = deps.sessions.addMessageToQueue(record.sessionId, record.content, undefined, record.steer);
    deps.delivery.broadcastToSession(record.sessionId, { type: 'queue.added', sessionId: record.sessionId, message: queued });
    deps.repository.update(record.key, { state: 'delivered', deliveredAt: now(), lastError: null });
    // A CLI session drains its queue only when woken; the Prokop turn
    // drains after its own cleanup.
    if (session.harness === 'codex-cli' || session.harness === 'claude-cli') {
      void deps.execution.drainQueue?.(wireFor(record.key, () => {}), deps.originFor(record.key), record.sessionId)
        .catch(() => undefined);
    }
    return 'queued';
  }

  function pending(record: SessionDeliveryRecord, reason: string, countAttempt = true): 'pending' | 'dropped' {
    const attempts = countAttempt ? record.attempts + 1 : record.attempts;
    if (attempts >= MAX_ATTEMPTS) {
      deps.repository.update(record.key, { state: 'dropped', attempts, lastError: `${reason} (gave up after ${attempts} attempts)` });
      return 'dropped';
    }
    deps.repository.update(record.key, { state: 'pending', attempts, lastError: reason });
    return 'pending';
  }

  async function attempt(key: string): Promise<SessionDeliveryOutcome> {
    const record = deps.repository.get(key);
    if (!record) return 'dropped';
    if (record.state === 'delivered') return 'duplicate';
    if (record.state === 'dropped') return 'dropped';

    const session = deps.sessions.getSession(record.sessionId);
    if (!session) {
      deps.repository.update(key, { state: 'dropped', lastError: 'Session not found' });
      return 'dropped';
    }
    if (session.status !== 'active') return pending(record, `Session is ${session.status}`);
    if (session.compacting) return pending(record, 'Session is compacting');
    if (deps.execution.isSessionActive(session.id) || session.runningAt) return queue(record, session);

    // Idle: start a turn. The turn runs past this call; an error the
    // harness reports before it starts (busy after all, invalid) comes back
    // on the wire and decides between the queue and another try later.
    deps.repository.update(key, { state: 'delivered', attempts: record.attempts + 1, deliveredAt: now(), lastError: null });
    let outcome: SessionDeliveryOutcome = 'started';
    // The attempt was counted above; a failure here only changes the state.
    const wire = wireFor(key, (message) => {
      const current = deps.repository.get(key);
      if (!current || current.state !== 'delivered' || current.deliveredAt === null) return;
      if (isBusyError(message)) {
        outcome = queue({ ...current, state: 'pending' }, session);
        return;
      }
      const reason = message.type === 'error' && message.message ? message.message : 'Delivery failed';
      outcome = pending({ ...current, state: 'pending' }, reason, false);
    });
    const turn = deps.execution.sendMessage(wire, deps.originFor(key), session.id, record.content);
    turn.catch((error: unknown) => {
      const current = deps.repository.get(key);
      if (current?.state === 'delivered') {
        pending({ ...current, state: 'pending' }, error instanceof Error ? error.message : 'Delivery failed', false);
      }
    });
    // Give a synchronous wire rejection a tick to land before reporting.
    await Promise.race([turn.then(() => undefined, () => undefined), new Promise<void>((resolve) => setTimeout(resolve, 0))]);
    return outcome;
  }

  const application: SessionDeliveryApplication = {
    deliver(input) {
      const inserted = deps.repository.insert({
        key: input.key,
        sessionId: input.sessionId,
        origin: input.origin,
        content: input.content,
        steer: input.steer === true,
        state: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: now(),
        deliveredAt: null,
      });
      if (!inserted) return Promise.resolve('duplicate');
      return serialized(input.sessionId, () => attempt(input.key));
    },

    retryPending(sessionId) {
      return serialized(sessionId, async () => {
        for (const record of deps.repository.listPending(sessionId)) {
          await attempt(record.key);
        }
      });
    },

    async retryAll() {
      const sessionIds = new Set(deps.repository.listPending().map((record) => record.sessionId));
      await Promise.all([...sessionIds].map((sessionId) => application.retryPending(sessionId)));
    },

    onSessionUpdated(session) {
      if (session.status !== 'active' || session.compacting || session.runningAt) return;
      if (deps.repository.listPending(session.id).length === 0) return;
      void application.retryPending(session.id);
    },
  };

  return application;
}
