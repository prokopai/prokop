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
 *
 * Work can outlive its request and keep using the request's wire (Codex
 * child turns, ask timeouts), as it would in process. So when a request
 * ends while the agent reports its session active, the token stays mapped
 * until the agent reports the session idle.
 */
export function createTurnForwarding(
  endpoint: () => HostEndpoint,
  fallbackDeliver: (params: DeliverParams) => void,
  /** Called whenever `busy()` may have changed (agent process idle exit). */
  onBusyChange: () => void = () => {},
): {
  executorFor(harness: SessionHarness, agentExecutor: AgentExecutor): AgentExecutor;
  /** An operation is in flight or the agent reports a session active. */
  busy(): boolean;
  /** The agent process died: its activity and kept wires are gone with it. */
  agentExited(): void;
  /** A headless run over `turn.headless`; its child session counts as active meanwhile. */
  headlessRun(): AgentHeadlessRun;
  notifications: Pick<NotificationHandlers<AgentSide>, 'deliver' | 'origin.attach' | 'session.activity'>;
} {
  const contexts = new Map<string, RequestContext>();
  const inFlight = new Map<string, number>();
  const agentActive = new Set<string>();
  /** Tokens of ended requests whose session the agent still reports active. */
  const lingering = new Map<string, Set<string>>();
  const release = (sessionId: string): void => {
    for (const token of lingering.get(sessionId) ?? []) contexts.delete(token);
    lingering.delete(sessionId);
  };

  /** Runs one request; `wire` (when given) serves its deliveries until it returns. */
  const run = async <T>(sessionId: string, counts: boolean, wire: SessionWirePorts<unknown> | undefined,
    origin: unknown, send: (token: string | null) => Promise<T>): Promise<T> => {
    const token = wire ? crypto.randomUUID() : null;
    if (token && wire) contexts.set(token, { wire, origin });
    if (counts) inFlight.set(sessionId, (inFlight.get(sessionId) ?? 0) + 1);
    onBusyChange();
    try {
      return await send(token);
    } finally {
      // The agent reported the session's activity before answering, so this is current.
      if (token && agentActive.has(sessionId)) {
        lingering.set(sessionId, (lingering.get(sessionId) ?? new Set()).add(token));
      } else {
        if (token) contexts.delete(token);
        release(sessionId);
      }
      if (counts) {
        const remaining = (inFlight.get(sessionId) ?? 1) - 1;
        if (remaining > 0) inFlight.set(sessionId, remaining);
        else inFlight.delete(sessionId);
      }
      onBusyChange();
    }
  };
  const originOf = (token: string | undefined): unknown => token ? contexts.get(token)?.origin : undefined;
  const host = { request: ((...args: Parameters<HostEndpoint['request']>) => endpoint().request(...args)) as HostEndpoint['request'] };

  return {
    busy: () => inFlight.size > 0 || agentActive.size > 0,
    agentExited() {
      for (const sessionId of [...lingering.keys()]) release(sessionId);
      agentActive.clear();
      onBusyChange();
    },
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
    headlessRun: () => (input, options) => run(input.childSessionId, true, undefined, undefined,
      () => host.request('turn.headless', input as Parameters<typeof host.request<'turn.headless'>>[1],
        { signal: options?.signal })),
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
        if (active) {
          agentActive.add(sessionId);
        } else {
          agentActive.delete(sessionId);
          release(sessionId);
        }
        onBusyChange();
      },
    },
  };
}
