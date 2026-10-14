import { join } from 'node:path';
import type { Audience } from '@prokopai/agent-protocol';
import { createProtocolRuntimeHost } from '@/agent-bridge/agent-runtime-host';
import { createProtocolStorageBundle } from '@/agent-bridge/agent-storage';
import {
  createProtocolKnowledgeWrite, createProtocolSessionSearchHost, createProtocolTerminals, createProtocolToolDiscovery,
} from '@/agent-bridge/agent-tools';
import { createRuntimeHostHandlers } from '@/agent-bridge/host-runtime';
import { createStorageHostHandlers } from '@/agent-bridge/host-storage';
import { createToolHostHandlers, type TerminalAccess } from '@/agent-bridge/host-tools';
import { agentLoopbackEnabled, createAgentLoopback } from '@/agent-bridge/loopback';
import { getProkopNotificationsApplication } from '@/adapters/prokop/notifications';
import { severityFromMode } from '@/domains/permissions';
import { audienceOf, mapCapekEventToServerMessage } from '@/harnesses/prokop/host/events';
import { prokopMcpAccess } from '@/harnesses/prokop/host/tool-source';
import { createProkopToolWorkspaceHost } from '@/harnesses/prokop/host/workspace';
import { configureAgentTerminals } from '@/harnesses/prokop/tools/terminal/port';
import { configureKnowledgeWrites } from '@/harnesses/shared/knowledge-writes';
import { executeMemoryTool } from '@/harnesses/shared/memory/memory-tool';
import { configureSessionSearchHost, getSessionSearchHost, type SessionSearchHost } from '@/harnesses/shared/session-search/host';
import { executeSkillManageTool } from '@/harnesses/shared/skills/skill-manage-tool';
import { getWorkspaceTools } from '@/infrastructure/mcp/manager';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { configureRuntimeHost, getRuntimeHost } from '@/infrastructure/runtime/host';
import { resolveWorkspaceDir, workspaceKnowledgeRoot } from '@/infrastructure/runtime/workspace-dirs';
import { isSandboxActive } from '@/infrastructure/sandbox';
import { addWorkspaceAdditionalPath, removeWorkspaceAdditionalPath } from '@/infrastructure/sqlite/workspaces';
import { configureStorage, getStorage } from '@/infrastructure/storage/runtime';
import { configureWorkspaceToolDiscovery } from '@/infrastructure/tools/tool-source';
import { getTerminalManager } from '@/transport/terminal';
import {
  broadcastEvent, broadcastToSessionEvent, sendToAskTargetsEvent, sendToControllerEvent,
} from '@/transport/websocket/broadcast';

/** The Prokop terminal port over the in-process terminal manager. */
export function terminalPortFromManager(manager: () => ReturnType<typeof getTerminalManager>): TerminalAccess {
  return {
    create: async options => manager().createSessionDetached(options),
    get: async id => manager().getSession(id),
    executionCwd: async id => manager().getSessionExecutionCwd(id),
    setCwd: async (id, cwd) => manager().updateSessionCwd(id, cwd),
    write: async (id, data) => manager().writeToSession(id, data),
    read: async (id, fromOffset, maxBytes) => manager().readBuffer(id, fromOffset, maxBytes),
    list: async workspacePath => manager().listSessionsForWorkspace(workspacePath),
    destroy: async (id) => {
      manager().destroySessionById(id);
    },
  };
}

/**
 * Installs the agent-facing host ports. In-process by default. With
 * PROKOPAI_AGENT_LOOPBACK=1 (host/agent split experiment,
 * docs/plans/host-agent-split.md), the configured in-process ports become
 * the host side of one protocol connection and the engine gets
 * protocol-backed replacements. Call after `configureProkopBindings()`,
 * before the execution scope is composed.
 */
export function configureAgentPorts(): void {
  const terminals = terminalPortFromManager(getTerminalManager);
  configureAgentTerminals(terminals);
  configureKnowledgeWrites(null);
  if (!agentLoopbackEnabled()) return;

  const hostStorage = getStorage();
  const hostRuntime = getRuntimeHost();
  const hostSessionSearch = getSessionSearchHost();
  const resolveSessionWorkspace = hostRuntime.workspace.resolveSessionWorkspace;
  if (!resolveSessionWorkspace) throw new Error('Agent loopback needs a host session workspace resolver');

  const runtime = createRuntimeHostHandlers({
    interaction: hostRuntime.interaction,
    resolveSessionWorkspace,
    knowledgeRoot: workspaceKnowledgeRoot,
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
  const tools = createToolHostHandlers({
    mcp: { grant: prokopMcpAccess.grant, check: prokopMcpAccess.check, tools: getWorkspaceTools },
    sessionSearch: hostSessionSearch as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>,
    applyKnowledge: async (kind, directory, input) => kind === 'memory'
      ? { ...await executeMemoryTool(input, directory, 'none', undefined, { local: true }) }
      : { ...await executeSkillManageTool(input, directory, 'none', undefined, { local: true }) },
    terminals,
  });
  const { agent } = createAgentLoopback({
    handlers: { ...createStorageHostHandlers(hostStorage), ...runtime.handlers, ...tools },
    notifications: runtime.notifications,
  });

  // Sync lookups the agent cannot ask the host for, filled from host answers.
  // Agent IDs: every session the agent reads or writes (a miss grants fewer
  // read roots). Knowledge roots: every resolved session root (a miss treats
  // the path as its own workspace).
  const agentIds = new Map<string, string | null>();
  const knowledgeRoots = new Map<string, string>();
  const knowledgeRootOf = (workspacePath: string): string => knowledgeRoots.get(workspacePath) ?? workspacePath;
  const storage = createProtocolStorageBundle(agent, {
    observeSession: session => agentIds.set(session.id, session.agentId ?? null),
  });

  configureStorage(storage);
  configureWorkspaceToolDiscovery(createProtocolToolDiscovery(agent));
  configureSessionSearchHost(createProtocolSessionSearchHost(agent) as unknown as SessionSearchHost);
  configureKnowledgeWrites(createProtocolKnowledgeWrite(agent));
  configureAgentTerminals(createProtocolTerminals(agent));
  configureRuntimeHost(createProtocolRuntimeHost(agent, {
    titles: hostRuntime.titles,
    toolPolicy: hostRuntime.toolPolicy,
    layout: hostRuntime.layout && {
      ...hostRuntime.layout,
      workspaceMemoryDir: workspacePath => resolveWorkspaceDir(knowledgeRootOf(workspacePath)),
      workspaceSkillsDir: workspacePath => join(knowledgeRootOf(workspacePath), '.agents', 'skills'),
    },
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
    onResolvedRoot: (workspacePath, knowledgeRoot) => knowledgeRoots.set(workspacePath, knowledgeRoot),
    toWire: (delivery) => {
      const message = mapCapekEventToServerMessage(delivery.event);
      const audience = audienceOf(delivery);
      if (!message || audience.scope === 'host' || audience.scope === 'origin') return null;
      return { audience: audience as Audience, message };
    },
  }));
  console.info('[agent-bridge] Prokop storage, runtime host and host tools run through the agent protocol loopback');
}
