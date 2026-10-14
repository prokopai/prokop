import type { AgentEndpoint, AgentHandlers, Audience } from '@prokopai/agent-protocol';
import type { ServerMessage, SessionHarness } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort } from '@/application/ports/execution';
import type { HeadlessSessionRunInput, HeadlessSessionRunResult } from '@/application/ports/headless-execution';
import { nextDeliverSeq } from './deliver-seq';

/** One harness's execution as the agent runs it; the host registers the same shape. */
export type AgentExecutor = Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive'>
  & Partial<Pick<SessionExecutionPort, 'editMessage' | 'regenerateTitle' | 'compact' | 'revert' | 'fork'
    | 'drainQueue' | 'steerQueue'>>;

/** A harness's headless child run (scheduled jobs, learning reviews). */
export type AgentHeadlessRun = (input: HeadlessSessionRunInput) => Promise<HeadlessSessionRunResult>;

/** The origin of a host request: a token the host maps back to its connection context. */
type OriginToken = string | null;

/** Session IDs a delivered message is about; their activity may have changed. */
function sessionsOf(audience: Audience, message: ServerMessage): string[] {
  const ids = new Set<string>();
  if ('sessionId' in audience) ids.add(audience.sessionId);
  const record = message as { sessionId?: unknown; session?: { id?: unknown } };
  if (typeof record.sessionId === 'string') ids.add(record.sessionId);
  if (typeof record.session?.id === 'string') ids.add(record.session.id);
  return [...ids];
}

/**
 * Agent side of the host's execution calls (`turn.*`, `compact`, `revert`,
 * `fork`, `title.generate`). Each request runs the real harness executor with
 * a wire whose deliveries become `deliver` notifications tagged with the
 * request's origin token, so the host routes them through that request's
 * connection context. The host answers `isSessionActive` itself from its
 * in-flight requests; activity that outlives a request (Codex child turns)
 * is reported with `session.activity` when it changes.
 */
export function createTurnHandlers(
  endpoint: AgentEndpoint,
  executors: Partial<Record<SessionHarness, AgentExecutor>>,
  headless: Partial<Record<SessionHarness, AgentHeadlessRun>> = {},
): AgentHandlers {
  const reported = new Map<string, boolean>();
  const executorOf = (harness: SessionHarness): AgentExecutor => {
    const executor = executors[harness];
    if (!executor) throw new Error(`This agent does not run ${harness} sessions`);
    return executor;
  };
  const report = (sessionId: string): void => {
    const active = Object.values(executors).some(executor => executor?.isSessionActive(sessionId));
    if ((reported.get(sessionId) ?? false) === active) return;
    if (active) reported.set(sessionId, true);
    else reported.delete(sessionId);
    endpoint.notify('session.activity', { sessionId, active });
  };
  const deliver = (origin: OriginToken, audience: Audience, message: ServerMessage): void => {
    endpoint.notify('deliver', { seq: nextDeliverSeq(endpoint), audience, message, ...(origin ? { origin } : {}) });
    for (const sessionId of sessionsOf(audience, message)) report(sessionId);
  };
  const wireFor = (origin: OriginToken): SessionWirePorts<OriginToken> => ({
    delivery: {
      send: (target, message) => {
        if (target) deliver(origin, { scope: 'origin', origin: target }, message);
      },
      broadcast: (message, exclude) => deliver(origin, { scope: 'global', ...(exclude ? { excludeOrigin: exclude } : {}) }, message),
      broadcastToSession: (sessionId, message, exclude) =>
        deliver(origin, { scope: 'session', sessionId, ...(exclude ? { excludeOrigin: exclude } : {}) }, message),
      sendToController: (sessionId, message) => deliver(origin, { scope: 'controller', sessionId }, message),
      sendToAskTargets: (sessionId, authority, message) =>
        deliver(origin, { scope: 'ask_targets', sessionId, authority }, message),
    },
    actor: {
      attachOriginToSession: (target, sessionId) => {
        if (target) endpoint.notify('origin.attach', { origin: target, sessionId });
      },
    },
  });
  /** Runs `operation` and reports the session's activity once it returns. */
  const settled = async <T>(sessionId: string, operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } finally {
      report(sessionId);
    }
  };
  const unsupported = (harness: SessionHarness, operation: string): never => {
    throw new Error(`${operation} is not supported for ${harness} sessions`);
  };

  return {
    'turn.start': ({ harness, origin, sessionId, content, attachments, responseFormatId, goalCondition, goalMaxTurns,
      goalTokenBudget }) => settled(sessionId, async () => {
      await executorOf(harness).sendMessage(wireFor(origin), origin, sessionId, content, attachments, responseFormatId,
        goalCondition, goalMaxTurns, goalTokenBudget);
      return {};
    }),
    'turn.edit': ({ harness, origin, sessionId, messageId, content }) => settled(sessionId, async () => {
      const executor = executorOf(harness);
      if (!executor.editMessage) unsupported(harness, 'editMessage');
      await executor.editMessage!(wireFor(origin), origin, { sessionId, messageId, content });
      return {};
    }),
    'turn.steer': ({ harness, origin, sessionId }) => settled(sessionId, async () => {
      await executorOf(harness).steerQueue?.(wireFor(origin), origin, sessionId);
      return {};
    }),
    'turn.drain': ({ harness, origin, sessionId }) => settled(sessionId, async () => {
      await executorOf(harness).drainQueue?.(wireFor(origin), origin, sessionId);
      return {};
    }),
    'turn.headless': input => settled(input.childSessionId, () => {
      const run = headless[input.harness];
      if (!run) unsupported(input.harness, 'headless runs');
      return run!(input as HeadlessSessionRunInput);
    }),
    'turn.interrupt': ({ harness, sessionId, reason }) =>
      settled(sessionId, () => executorOf(harness).interruptSession(sessionId, reason)),
    'title.generate': async ({ harness, origin, sessionId, force }) => {
      const executor = executorOf(harness);
      if (!executor.regenerateTitle) unsupported(harness, 'regenerateTitle');
      await executor.regenerateTitle!(wireFor(origin), origin, sessionId, force === undefined ? undefined : { force });
      return {};
    },
    compact: ({ harness, origin, sessionId, reason }) => settled(sessionId, () => {
      const executor = executorOf(harness);
      if (!executor.compact) unsupported(harness, 'compact');
      // No origin: the host passed no delivery, so compaction state is not broadcast.
      return executor.compact!(sessionId, reason,
        origin ? wireFor(origin).delivery as SessionWirePorts<unknown>['delivery'] : undefined);
    }),
    revert: ({ harness, sessionId, targetMessageId }) => settled(sessionId, () => {
      const executor = executorOf(harness);
      if (!executor.revert) unsupported(harness, 'revert');
      return executor.revert!({ sessionId, targetMessageId });
    }),
    fork: ({ harness, sessionId, targetMessageId, title }) => settled(sessionId, async () => {
      const executor = executorOf(harness);
      if (!executor.fork) unsupported(harness, 'fork');
      return executor.fork!({ sessionId, targetMessageId, ...(title !== undefined ? { title } : {}) });
    }),
  };
}
