import type { RouterContext } from '@/transport/websocket/router-context';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { handleClientRegistration, getClientByClientId, getClientIdForConnection, getConnectionById } from '@/transport/websocket/connection-registry';
import { sandboxController } from '@prokopai/core/infrastructure/sandbox/controller';
import type { SandboxRespondMessage } from '@prokopai/core/infrastructure/sandbox/types';
import {
  resolveAsk as capekResolveAsk, getSessionIdForPendingAsk as capekGetSessionIdForPendingAsk, getAuthorityForPendingAsk as capekGetAuthorityForPendingAsk,
} from '@prokopai/agent/host';
import { getBrowserRequestsPort } from '@/application/ports/browser';
import { getControlState } from '@/transport/websocket/control-registry';
import { requireWireApplication } from '@/transport/websocket/application';
import { checkAskResponseEligibility } from '@/application/ports/control';
import { getAgentAskPort, isNativeHarnessAskId } from '@prokopai/core/application/ports/agent-asks';
import type {
  ClientRegisterMessage,
  AskResponseMessage,
  AskAuthority,
  NotificationAcknowledgeMessage,
  PongMessage,
} from '@prokopai/sdk';

export function handleClientRegister(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: ClientRegisterMessage,
): void {
  handleClientRegistration(ws, msg, ctx.send);
}

export function handlePong(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  _msg: PongMessage,
): void {
  const clientData = ctx.clients.get(ws);
  if (clientData) {
    clientData.missedPings = 0;
  }
}

export function handleNotificationAcknowledge(
  _ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: NotificationAcknowledgeMessage,
): void {
  const conn = getConnectionById(ws);
  const clientId = conn?.clientId ?? null;
  if (!clientId) {
    return;
  }

  requireWireApplication().notifications.acknowledgePendingNotification(msg.eventId, msg.sessionId, clientId);
}

export interface AskResponseDependencies {
  resolveAsk(toolCallId: string, response: unknown, requestId?: string, sessionId?: string | null): Promise<boolean>;
  getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null>;
  getAuthorityForPendingAsk(toolCallId: string, requestId?: string): AskAuthority | undefined | Promise<AskAuthority | undefined>;
}

/**
 * Every ask's waiter lives in the agent (`ask.lookup`, `ask.resolve`). With no
 * agent ask port installed (router-level tests, hosts without the wired
 * application) the process-default Capek runtime answers, matching behavior
 * before the composition resolves.
 */
const askResponseDependencies: AskResponseDependencies = {
  resolveAsk: (toolCallId, response, requestId, sessionId) => {
    const port = getAgentAskPort();
    return port ? port.resolve({ ...(sessionId ? { sessionId } : {}), toolCallId, requestId, response })
      : capekResolveAsk(toolCallId, response, requestId);
  },
  getSessionIdForPendingAsk: async (toolCallId, requestId) => {
    const port = getAgentAskPort();
    return port ? (await port.lookup(toolCallId, requestId))?.sessionId ?? null
      : capekGetSessionIdForPendingAsk(toolCallId, requestId);
  },
  getAuthorityForPendingAsk: async (toolCallId, requestId) => {
    const port = getAgentAskPort();
    return port ? (await port.lookup(toolCallId, requestId))?.authority
      : capekGetAuthorityForPendingAsk(toolCallId);
  },
};

export async function handleAskResponseWithDependencies(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: AskResponseMessage,
  dependencies: AskResponseDependencies,
): Promise<void> {
  const { toolCallId, response, requestId } = msg;
  const askSessionId = await dependencies.getSessionIdForPendingAsk(toolCallId, requestId);
  // Native harness requests require a live request identity, never a legacy tool-call fallback.
  if (isNativeHarnessAskId(toolCallId) && (!requestId || !askSessionId)) return;
  if (askSessionId) {
    const controlState = getControlState(askSessionId);
    const senderClientId = getClientIdForConnection(ws);

    const askAuthority: AskAuthority =
      await dependencies.getAuthorityForPendingAsk(toolCallId, requestId) ?? {
        visibilityScope: 'controller_only',
        resolutionMode: 'controller_only',
      };

    if (!senderClientId && controlState.status !== 'uncontrolled') {
      ctx.send(ws, {
        type: 'ask.response_rejected',
        sessionId: askSessionId,
        toolCallId,
        requestId,
        code: 'not_allowed',
        message: 'Client must be registered to respond to asks',
      });
      return;
    }

    const eligibility = checkAskResponseEligibility({
      clientId: senderClientId ?? '',
      capabilities: senderClientId
        ? (getClientByClientId(senderClientId)?.capabilities ?? [])
        : [],
      controllerClientId: controlState.controllerClientId ?? null,
      authority: askAuthority,
    });

    if (!eligibility.eligible) {
      ctx.send(ws, {
        type: 'ask.response_rejected',
        sessionId: askSessionId,
        toolCallId,
        requestId,
        code: senderClientId !== controlState.controllerClientId ? 'not_controller' : 'not_allowed',
        message: eligibility.reason ?? 'You are not eligible to respond to this ask',
      });
      return;
    }
  }
  await dependencies.resolveAsk(toolCallId, response, requestId, askSessionId);
}

export async function handleAskResponse(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: AskResponseMessage,
): Promise<void> {
  if (msg.toolCallId.startsWith('browser-request:')) {
    const browser = getBrowserRequestsPort();
    if (!browser || !msg.requestId || !browser.acceptsConnection(msg.toolCallId, ws)
      || !await browser.getSessionIdForPendingAsk(msg.toolCallId, msg.requestId)) return;
    await handleAskResponseWithDependencies(ctx, ws, msg, browser);
    return;
  }
  await handleAskResponseWithDependencies(ctx, ws, msg, askResponseDependencies);
}

export function handleSandboxRespond(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SandboxRespondMessage,
): void {
  try {
    sandboxController.respond(msg.callId, msg.response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sandbox response failed';
    ctx.send(ws, { type: 'error', code: 'sandbox_error', message });
  }
}
