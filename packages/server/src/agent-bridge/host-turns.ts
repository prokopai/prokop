import type { AgentSide, Audience, HostEndpoint, NotificationHandlers } from '@prokopai/agent-protocol';
import type { ServerMessage, SessionHarness } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { AgentExecutor, AgentHeadlessRun } from './agent-turns';

interface RequestContext {
  wire: SessionWirePorts<unknown>;
  origin: unknown;
}

type DeliverParams = { audience: Audience; message: ServerMessage; origin?: string | null };

/**
 * Host side of the execution port over the agent protocol. Each harness
 * registration becomes a forwarding executor: every call is a `turn.*`
 * (or `compact`/`revert`/`fork`/`title.generate`) request. The request's
 * wire and origin stay on the host under an opaque token; deliveries that
 * carry the token are routed through that wire exactly like in-process
 * calls. `isSessionActive` is host state: an operation in flight for the
 * session, or activity the agent reported.
 */
export function createTurnForwarding(endpoint: () => HostEndpoint, fallbackDeliver: (params: DeliverParams) => void): {
  executorFor(harness: SessionHarness, agentExecutor: AgentExecutor): AgentExecutor;
  /** A headless run over `turn.headless`; its child session counts as active meanwhile. */
  headlessRun(): AgentHeadlessRun;
  notifications: Pick<NotificationHandlers<AgentSide>, 'deliver' | 'origin.attach' | 'session.activity'>;
} {
  const contexts = new Map<string, RequestContext>();
  const inFlight = new Map<string, number>();
  const agentActive = new Set<string>();

  /** Runs one request; `wire` (when given) serves its deliveries until it returns. */
  const run = async <T>(sessionId: string, counts: boolean, wire: SessionWirePorts<unknown> | undefined,
    origin: unknown, send: (token: string | null) => Promise<T>): Promise<T> => {
    const token = wire ? crypto.randomUUID() : null;
    if (token && wire) contexts.set(token, { wire, origin });
    if (counts) inFlight.set(sessionId, (inFlight.get(sessionId) ?? 0) + 1);
    try {
      return await send(token);
    } finally {
      // Later deliveries with this token (work that outlives the request) use the host router.
      if (token) contexts.delete(token);
      if (counts) {
        const remaining = (inFlight.get(sessionId) ?? 1) - 1;
        if (remaining > 0) inFlight.set(sessionId, remaining);
        else inFlight.delete(sessionId);
      }
    }
  };
  const originOf = (token: string | undefined): unknown => token ? contexts.get(token)?.origin : undefined;
  const host = { request: ((...args: Parameters<HostEndpoint['request']>) => endpoint().request(...args)) as HostEndpoint['request'] };

  return {
    executorFor(harness, agentExecutor) {
      const executor: AgentExecutor = {
        sendMessage: (wire, origin, sessionId, content, attachments, responseFormatId, goalCondition, goalMaxTurns,
          goalTokenBudget) => run(sessionId, true, wire as SessionWirePorts<unknown>, origin, async (token) => {
          await host.request('turn.start', { harness, origin: token, sessionId, content, attachments, responseFormatId,
            goalCondition, goalMaxTurns, goalTokenBudget });
        }),
        interruptSession: (sessionId, reason) => host.request('turn.interrupt', { harness, sessionId, reason }),
        isSessionActive: sessionId => inFlight.has(sessionId) || agentActive.has(sessionId),
      };
      if (agentExecutor.editMessage) {
        executor.editMessage = (wire, origin, input) => run(input.sessionId, true, wire as SessionWirePorts<unknown>,
          origin, async (token) => { await host.request('turn.edit', { harness, origin: token, ...input }); });
      }
      if (agentExecutor.steerQueue) {
        executor.steerQueue = (wire, origin, sessionId) => run(sessionId, false, wire as SessionWirePorts<unknown>,
          origin, async (token) => { await host.request('turn.steer', { harness, origin: token, sessionId }); });
      }
      if (agentExecutor.drainQueue) {
        executor.drainQueue = (wire, origin, sessionId) => run(sessionId, true, wire as SessionWirePorts<unknown>,
          origin, async (token) => { await host.request('turn.drain', { harness, origin: token, sessionId }); });
      }
      if (agentExecutor.regenerateTitle) {
        executor.regenerateTitle = (wire, origin, sessionId, options) => run(sessionId, false,
          wire as SessionWirePorts<unknown>, origin, async (token) => {
            await host.request('title.generate', { harness, origin: token, sessionId, force: options?.force });
          });
      }
      if (agentExecutor.compact) {
        executor.compact = (sessionId, reason, delivery) => run(sessionId, true,
          delivery ? { delivery, actor: { attachOriginToSession: () => {} } } : undefined, undefined,
          token => host.request('compact', { harness, origin: token, sessionId, reason }));
      }
      if (agentExecutor.revert) {
        executor.revert = input => run(input.sessionId, true, undefined, undefined,
          () => host.request('revert', { harness, ...input }));
      }
      if (agentExecutor.fork) {
        executor.fork = input => run(input.sessionId, true, undefined, undefined,
          async () => await host.request('fork', { harness, ...input }) as Awaited<ReturnType<NonNullable<AgentExecutor['fork']>>>);
      }
      return executor;
    },
    headlessRun: () => input => run(input.childSessionId, true, undefined, undefined,
      () => host.request('turn.headless', input as Parameters<typeof host.request<'turn.headless'>>[1])),
    notifications: {
      deliver: (params) => {
        const context = params.origin ? contexts.get(params.origin) : undefined;
        if (!context) {
          fallbackDeliver(params);
          return;
        }
        const { delivery } = context.wire;
        const { audience, message } = params;
        switch (audience.scope) {
          case 'origin': {
            const target = contexts.get(audience.origin);
            if (target) delivery.send(target.origin, message);
            break;
          }
          case 'global': delivery.broadcast(message, originOf(audience.excludeOrigin)); break;
          case 'session': delivery.broadcastToSession(audience.sessionId, message, originOf(audience.excludeOrigin)); break;
          case 'controller': delivery.sendToController(audience.sessionId, message); break;
          case 'ask_targets': delivery.sendToAskTargets(audience.sessionId, audience.authority, message); break;
        }
      },
      'origin.attach': ({ origin, sessionId }) => {
        const context = contexts.get(origin);
        context?.wire.actor.attachOriginToSession(context.origin, sessionId);
      },
      'session.activity': ({ sessionId, active }) => {
        if (active) agentActive.add(sessionId);
        else agentActive.delete(sessionId);
      },
    },
  };
}
