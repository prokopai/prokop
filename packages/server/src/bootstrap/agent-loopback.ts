import type { Audience } from '@prokopai/agent-protocol';
import { createProtocolRuntimeHost } from '@/agent-bridge/agent-runtime-host';
import { createProtocolStorageBundle } from '@/agent-bridge/agent-storage';
import { createRuntimeHostHandlers } from '@/agent-bridge/host-runtime';
import { createStorageHostHandlers } from '@/agent-bridge/host-storage';
import { agentLoopbackEnabled, createAgentLoopback } from '@/agent-bridge/loopback';
import { getProkopNotificationsApplication } from '@/adapters/prokop/notifications';
import { severityFromMode } from '@/domains/permissions';
import { audienceOf, mapCapekEventToServerMessage } from '@/harnesses/prokop/host/events';
import { createProkopToolWorkspaceHost } from '@/harnesses/prokop/host/workspace';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { configureRuntimeHost, getRuntimeHost } from '@/infrastructure/runtime/host';
import { isSandboxActive } from '@/infrastructure/sandbox';
import { addWorkspaceAdditionalPath, removeWorkspaceAdditionalPath } from '@/infrastructure/sqlite/workspaces';
import { configureStorage, getStorage } from '@/infrastructure/storage/runtime';
import {
  broadcastEvent, broadcastToSessionEvent, sendToAskTargetsEvent, sendToControllerEvent,
} from '@/transport/websocket/broadcast';

/**
 * Host/agent split experiment (docs/plans/host-agent-split.md, Phase 1).
 * With PROKOPAI_AGENT_LOOPBACK=1, the configured SQLite storage and Prokop
 * runtime host become the host side of one in-process protocol connection,
 * and the engine gets protocol-backed replacements. Call after
 * `configureProkopBindings()`, before the execution scope is composed.
 */
export function configureAgentLoopback(): void {
  if (!agentLoopbackEnabled()) return;
  const hostStorage = getStorage();
  const hostRuntime = getRuntimeHost();
  const resolveSessionWorkspace = hostRuntime.workspace.resolveSessionWorkspace;
  if (!resolveSessionWorkspace) throw new Error('Agent loopback needs a host session workspace resolver');

  const runtime = createRuntimeHostHandlers({
    interaction: hostRuntime.interaction,
    resolveSessionWorkspace,
    addWorkspaceRoot: addWorkspaceAdditionalPath,
    removeWorkspaceRoot: removeWorkspaceAdditionalPath,
    router: {
      broadcast: broadcastEvent,
      broadcastToSession: broadcastToSessionEvent,
      sendToController: sendToControllerEvent,
      sendToAskTargets: sendToAskTargetsEvent,
    },
    notifyTurnFinished: (message, sessionId) =>
      getProkopNotificationsApplication().notifyTerminalMessage(message, sessionId),
  });
  const { agent } = createAgentLoopback({
    handlers: { ...createStorageHostHandlers(hostStorage), ...runtime.handlers },
    notifications: runtime.notifications,
  });

  // Sync lookups the agent cannot ask the host for: the session's agent ID
  // (tool read roots). Filled from every session the agent reads or writes;
  // a miss grants fewer read roots, never more.
  const agentIds = new Map<string, string | null>();
  const storage = createProtocolStorageBundle(agent, {
    observeSession: session => agentIds.set(session.id, session.agentId ?? null),
  });

  configureStorage(storage);
  configureRuntimeHost(createProtocolRuntimeHost(agent, {
    titles: hostRuntime.titles,
    toolPolicy: hostRuntime.toolPolicy,
    // Memory/skills layout still reads the host database; it moves with the domain tools (step 1e).
    layout: hostRuntime.layout,
    guidance: hostRuntime.guidance,
    isSandboxActive,
    getPermissionTimeoutMs,
    autoApproveSeverity: async (sessionId) => {
      const session = await storage.conversation.getSession(sessionId);
      return session ? severityFromMode(session.permissionMode ?? 'standard') : undefined;
    },
    createToolWorkspaceHost: (options, roots) => createProkopToolWorkspaceHost(options, {
      agentIdOf: sessionId => agentIds.get(sessionId),
      addRoot: roots.add,
      removeRoot: roots.remove,
    }),
    toWire: (delivery) => {
      const message = mapCapekEventToServerMessage(delivery.event);
      const audience = audienceOf(delivery);
      if (!message || audience.scope === 'host' || audience.scope === 'origin') return null;
      return { audience: audience as Audience, message };
    },
  }));
  console.info('[agent-bridge] Prokop storage and runtime host run through the agent protocol loopback');
}
