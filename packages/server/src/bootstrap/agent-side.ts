import { join } from 'node:path';
import type { AgentEndpoint, AgentHandlers, Audience } from '@prokopai/agent-protocol';
import type { SessionHarness } from '@prokopai/sdk';
import { createProtocolHarnessAsks } from '@/agent-bridge/agent-asks';
import { createProtocolRuntimeHost } from '@/agent-bridge/agent-runtime-host';
import { createProtocolStorageBundle } from '@/agent-bridge/agent-storage';
import {
  createProtocolKnowledgeWrite, createProtocolMcpTools, createProtocolSessionSearchHost, createProtocolTerminals, createProtocolToolDiscovery,
} from '@/agent-bridge/agent-tools';
import { createTurnHandlers, type AgentExecutor, type AgentHeadlessRun } from '@/agent-bridge/agent-turns';
import { installHarnessNotificationPort } from '@/application/ports/harness-notifications';
import { installLearningReviewToolPort } from '@/application/ports/learning-review-tools';
import { configureHarnessMcpTools } from '@/application/ports/mcp-tools';
import { severityFromMode } from '@/domains/permissions';
import { audienceOf, mapCapekEventToServerMessage } from '@/harnesses/prokop/host/events';
import { createProkopToolWorkspaceHost } from '@/harnesses/prokop/host/workspace';
import { configureAgentTerminals } from '@/harnesses/prokop/tools/terminal/port';
import { configureKnowledgeWrites } from '@/harnesses/shared/knowledge-writes';
import { configureSessionSearchHost, type SessionSearchHost } from '@/harnesses/shared/session-search/host';
import { configureHarnessAsks } from '@/infrastructure/runtime/harness-asks';
import { configureRuntimeHost, type RuntimeHost } from '@/infrastructure/runtime/host';
import { resolveWorkspaceDir } from '@/infrastructure/runtime/workspace-dirs';
import { configureStorage } from '@/infrastructure/storage/runtime';
import { configureWorkspaceToolDiscovery } from '@/infrastructure/tools/tool-source';
import { askHandlers } from './agent-asks';
import { probeHandlers } from './agent-probes';

/** Host settings the agent reads synchronously (`initialize` carries them across a process boundary). */
export interface AgentSideSettings {
  isSandboxActive(): boolean;
  getPermissionTimeoutMs(): number;
}

export type AgentRegistrations = Record<SessionHarness, { execution: AgentExecutor; headless?: AgentHeadlessRun }>;

/**
 * Agent half of the agent protocol, the same in the in-process loopback and
 * in the agent process. Replaces every host-reaching port of this process
 * with one backed by `agent`, and fills `handlers` with what the host may
 * call: asks, probes and, once `registerExecutors` runs, turns. `local` is
 * this process's own runtime host (the Prokop bindings); its agent-local
 * parts (titles, tool policy, layout, guidance) stay in use.
 */
export function composeAgentSide(
  agent: AgentEndpoint,
  handlers: AgentHandlers,
  local: RuntimeHost,
  settings: AgentSideSettings,
): { registerExecutors(registrations: AgentRegistrations): void } {
  Object.assign(handlers, askHandlers, probeHandlers);
  installHarnessNotificationPort({
    notifyTerminalMessage: (message, sessionId) =>
      agent.notify('host.notify', { kind: 'turn.finished', sessionId, message }),
    notifyPermissionRequired: (requestId, rootSessionId) =>
      agent.notify('host.notify', { kind: 'permission.required', requestId, rootSessionId }),
    notifyWorktreeChanged: worktreeId => agent.notify('host.notify', { kind: 'worktree.changed', worktreeId }),
  });
  installLearningReviewToolPort({
    call: (sessionId, name, input) => agent.request('learning.tool', { sessionId, name, arguments: input }),
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
  configureHarnessAsks(createProtocolHarnessAsks(agent));
  configureHarnessMcpTools(createProtocolMcpTools(agent));
  configureRuntimeHost(createProtocolRuntimeHost(agent, {
    titles: local.titles,
    toolPolicy: local.toolPolicy,
    layout: local.layout && {
      ...local.layout,
      workspaceMemoryDir: workspacePath => resolveWorkspaceDir(knowledgeRootOf(workspacePath)),
      workspaceSkillsDir: workspacePath => join(knowledgeRootOf(workspacePath), '.agents', 'skills'),
    },
    guidance: local.guidance,
    isSandboxActive: settings.isSandboxActive,
    getPermissionTimeoutMs: settings.getPermissionTimeoutMs,
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

  return {
    registerExecutors(registrations) {
      const executors = Object.fromEntries(Object.entries(registrations)
        .map(([harness, registration]) => [harness, registration.execution])) as Record<SessionHarness, AgentExecutor>;
      const headless = Object.fromEntries(Object.entries(registrations).flatMap(([harness, registration]) =>
        registration.headless ? [[harness, registration.headless]] : [])) as Partial<Record<SessionHarness, AgentHeadlessRun>>;
      Object.assign(handlers, createTurnHandlers(agent, executors, headless));
    },
  };
}
