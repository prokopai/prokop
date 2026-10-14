import { fileURLToPath } from 'node:url';
import {
  PROTOCOL_VERSION, type AgentHandlers, type AgentSide, type HostEndpoint, type HostHandlers, type NotificationHandlers,
} from '@prokopai/agent-protocol';
import { createAgentSupervisor, type AgentSupervisor } from '@/agent-bridge/agent-supervisor';
import { readEnv } from '@/infrastructure/runtime/env-compat';
import serverPackage from '@/../package.json' with { type: 'json' };
import { recoverAfterAgentExit } from './agent-recovery';
import type { SessionHarness } from '@prokopai/sdk';
import { installHarnessNotificationPort, type HarnessNotificationPort } from '@/application/ports/harness-notifications';
import type { AgentExecutor, AgentHeadlessRun } from '@/agent-bridge/agent-turns';
import { createTurnForwarding } from '@/agent-bridge/host-turns';
import { createProtocolHarnessProbes } from '@/agent-bridge/host-probes';
import { configureHarnessProbes } from '@/application/ports/harness-probes';
import type { HarnessOperation } from '@/application/sessions/harness-execution';
import { localHarnessProbes } from './agent-probes';
import { composeAgentSide } from './agent-side';
import { isKnowledgeDirectory } from './knowledge-directories';
import { createRuntimeHostHandlers } from '@/agent-bridge/host-runtime';
import { createStorageHostHandlers } from '@/agent-bridge/host-storage';
import { createToolHostHandlers, type SessionSearchService, type TerminalAccess } from '@/agent-bridge/host-tools';
import { agentLoopbackEnabled, agentProcessEnabled, createAgentLoopback } from '@/agent-bridge/loopback';
import { getProkopNotificationsApplication } from '@/adapters/prokop/notifications';
import { prokopMcpAccess } from '@/harnesses/prokop/host/tool-source';
import { configureAgentTerminals } from '@/harnesses/prokop/tools/terminal/port';
import { configureKnowledgeWrites } from '@/harnesses/shared/knowledge-writes';
import { executeMemoryTool } from '@/harnesses/shared/memory/memory-tool';
import { getSessionSearchHost } from '@/harnesses/shared/session-search/host';
import { executeSkillManageTool } from '@/harnesses/shared/skills/skill-manage-tool';
import { getWorkspaceTools } from '@/infrastructure/mcp/manager';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { getRuntimeHost } from '@/infrastructure/runtime/host';
import { getDataDir } from '@/infrastructure/runtime/paths';
import { workspaceKnowledgeRoot } from '@/infrastructure/runtime/workspace-dirs';
import { isSandboxActive } from '@/infrastructure/sandbox';
import { sandboxController } from '@/infrastructure/sandbox/controller';
import type { LlmCallContext } from '@/infrastructure/sandbox/types';
import { addWorkspaceAdditionalPath, removeWorkspaceAdditionalPath } from '@/infrastructure/sqlite/workspaces';
import { getStorage } from '@/infrastructure/storage/runtime';
import { getTerminalManager } from '@/transport/terminal';
import {
  broadcastEvent, broadcastToSessionEvent, sendToAskTargetsEvent, sendToControllerEvent,
} from '@/transport/websocket/broadcast';
import { configureHarnessAsks } from '@/infrastructure/runtime/harness-asks';
import { createHarnessAskHandlers } from '@/agent-bridge/host-asks';
import { localHarnessAsks } from './harness-asks';
import { installAgentAskPort } from '@/application/ports/agent-asks';
import { configureHarnessMcpTools } from '@/application/ports/mcp-tools';
import { directAgentAsks, protocolAgentAsks } from './agent-asks';
import { installLearningReviewToolPort } from '@/application/ports/learning-review-tools';
import { learningReviewTools } from '@/application/learning/review-tools';

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

/** A registration as the host routes it; `hostOperations` stay host-side. */
type HostRegistration = { execution: AgentExecutor; headless?: AgentHeadlessRun; hostOperations?: HarnessOperation[] };

let bindExecutors: <R extends Record<SessionHarness, HostRegistration>>(registrations: R) => R =
  registrations => registrations;

/**
 * The harness registrations the host's execution port routes to. With the
 * agent loopback each one forwards over `turn.*` to the same executor
 * running agent-side; otherwise they are returned unchanged.
 */
export function bindHarnessExecutors<R extends Record<SessionHarness, HostRegistration>>(registrations: R): R {
  return bindExecutors(registrations);
}

let worktreeListener: ((worktreeId: string) => void) | null = null;

/** The host's reaction to `worktree.changed`, wherever the harness runs. */
export function onHarnessWorktreeChanged(listener: (worktreeId: string) => void): void {
  worktreeListener = listener;
}

/** In-process harness push notifications. */
const localHarnessNotifications: HarnessNotificationPort = {
  notifyWorktreeChanged: worktreeId => worktreeListener?.(worktreeId),
  notifyTerminalMessage: (message: Parameters<HarnessNotificationPort['notifyTerminalMessage']>[0], sessionId: string) =>
    getProkopNotificationsApplication().notifyTerminalMessage(message, sessionId),
  notifyPermissionRequired: (requestId: string, rootSessionId: string) =>
    getProkopNotificationsApplication().notifyPermissionRequired(requestId, rootSessionId),
};

/**
 * Host half of the agent protocol: what the host serves (storage, runtime
 * host, host tools, harness asks, learning tools), the notifications it
 * handles, and the registrations it routes to, forwarded over `turn.*`.
 * `connect` supplies the endpoint once the channel exists (a loopback or an
 * agent process).
 */
export function createAgentHostSide(options: { onBusyChange?: () => void } = {}): {
  handlers: HostHandlers;
  notifications: NotificationHandlers<AgentSide>;
  connect(endpoint: () => HostEndpoint): void;
  bind<R extends Record<SessionHarness, HostRegistration>>(registrations: R): R;
  /** Agent work the host knows of: operations in flight, sessions reported active. */
  busy(): boolean;
  agentExited(): void;
} {
  const hostStorage = getStorage();
  const hostRuntime = getRuntimeHost();
  const hostSessionSearch = getSessionSearchHost();
  const resolveSessionWorkspace = hostRuntime.workspace.resolveSessionWorkspace;
  if (!resolveSessionWorkspace) throw new Error('Agent protocol needs a host session workspace resolver');
  let endpoint: (() => HostEndpoint) | null = null;
  const host = (): HostEndpoint => {
    if (!endpoint) throw new Error('No agent connected');
    return endpoint();
  };

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
    notifyWorktreeChanged: worktreeId => worktreeListener?.(worktreeId),
    notifyTurnFinished: (message, sessionId) =>
      getProkopNotificationsApplication().notifyTerminalMessage(message, sessionId),
  });
  const tools = createToolHostHandlers({
    mcp: { grant: prokopMcpAccess.grant, check: prokopMcpAccess.check, tools: getWorkspaceTools },
    sessionSearch: hostSessionSearch as unknown as SessionSearchService,
    applyKnowledge: async (kind, directory, input) => {
      if (!isKnowledgeDirectory(kind, directory)) throw new Error('Not a workspace or agent knowledge directory');
      return kind === 'memory'
        ? { ...await executeMemoryTool(input, directory, 'none', undefined, { local: true }) }
        : { ...await executeSkillManageTool(input, directory, 'none', undefined, { local: true }) };
    },
    terminals: terminalPortFromManager(getTerminalManager),
  });
  const turns = createTurnForwarding(host, params => runtime.notifications.deliver?.(params as never),
    () => options.onBusyChange?.());

  return {
    handlers: {
      ...createStorageHostHandlers(hostStorage), ...runtime.handlers, ...tools,
      ...createHarnessAskHandlers(localHarnessAsks),
      'learning.tool': async ({ sessionId, name, arguments: input }) => ({ ...await learningReviewTools.call(sessionId, name, input) }),
      'sandbox.call': async ({ context }, { signal }) =>
        ({ ...await sandboxController.waitForResponse(context as unknown as LlmCallContext, signal) }),
    },
    notifications: {
      ...runtime.notifications, ...turns.notifications,
      'sandbox.completed': ({ callId }) => sandboxController.complete(callId),
    },
    busy: turns.busy,
    agentExited: turns.agentExited,
    connect(next) {
      endpoint = next;
      configureHarnessProbes(createProtocolHarnessProbes(host));
      installAgentAskPort(protocolAgentAsks({
        lookup: (toolCallId, requestId) => host().request('ask.lookup', { toolCallId, requestId }),
        resolve: async answer => (await host().request('ask.resolve', answer)).resolved,
      }));
    },
    bind: registrations => Object.fromEntries(Object.entries(registrations).map(([harness, registration]) => {
      const forwarded = turns.executorFor(harness as SessionHarness, registration.execution);
      // Operations the composition root built from host services never cross.
      for (const operation of registration.hostOperations ?? []) {
        (forwarded as Record<string, unknown>)[operation] = registration.execution[operation];
      }
      return [harness, {
        ...registration,
        execution: forwarded,
        ...(registration.headless ? { headless: turns.headlessRun() } : {}),
      }];
    })) as typeof registrations,
  };
}

/**
 * Installs the agent-facing host ports. In-process by default. With
 * PROKOPAI_AGENT_LOOPBACK=1 (host/agent split experiment,
 * docs/plans/host-agent-split.md), both halves of the agent protocol run in
 * this process over a loopback: the host half serves the configured
 * in-process ports and the agent half replaces them with protocol-backed
 * ones. Call after `configureProkopBindings()`, before the execution scope
 * is composed.
 */
export function configureAgentPorts(): void {
  configureAgentTerminals(terminalPortFromManager(getTerminalManager));
  configureKnowledgeWrites(null);
  configureHarnessAsks(localHarnessAsks);
  configureHarnessMcpTools({ tools: getWorkspaceTools });
  if (agentProcessEnabled()) {
    configureAgentProcess();
    return;
  }
  if (!agentLoopbackEnabled()) {
    installAgentAskPort(directAgentAsks);
    installLearningReviewToolPort(learningReviewTools);
    installHarnessNotificationPort(localHarnessNotifications);
    configureHarnessProbes(localHarnessProbes);
    bindExecutors = registrations => registrations;
    return;
  }

  const hostSide = createAgentHostSide();
  const local = getRuntimeHost();
  const agentHandlers: AgentHandlers = {};
  const { agent, host } = createAgentLoopback({ handlers: hostSide.handlers, notifications: hostSide.notifications },
    agentHandlers);
  hostSide.connect(() => host);
  const agentSide = composeAgentSide(agent, agentHandlers, local, { isSandboxActive, getPermissionTimeoutMs });
  bindExecutors = (registrations) => {
    agentSide.registerExecutors(registrations);
    return hostSide.bind(registrations);
  };
  console.info('[agent-bridge] harness storage, asks, runtime host and host tools run through the agent protocol loopback');
}

let supervisor: AgentSupervisor | null = null;

/** The supervised agent process, when PROKOPAI_AGENT_PROCESS=1. */
export function getAgentSupervisor(): AgentSupervisor | null {
  return supervisor;
}

/** `bun packages/agent/src/main.ts --stdio`. */
function agentProcessCommand(): string[] {
  return [process.execPath, fileURLToPath(new URL('../../../agent/src/main.ts', import.meta.url)), '--stdio'];
}

/**
 * PROKOPAI_AGENT_PROCESS=1 (Phase 2): the host half serves a supervised
 * agent process. This process keeps its in-process ports for host work;
 * every harness operation goes to the agent.
 */
function configureAgentProcess(): void {
  // Reconfiguring (each createRuntime) must not leave the previous agent process running.
  // Executors bound to it stay usable: their next request starts a process with the current settings.
  void supervisor?.stop();
  installLearningReviewToolPort(learningReviewTools);
  installHarnessNotificationPort(localHarnessNotifications);
  const hostSide = createAgentHostSide({ onBusyChange: () => supervisor?.activityChanged() });
  const idleMs = Number(readEnv('AGENT_IDLE_MS') ?? 5 * 60_000);
  supervisor = createAgentSupervisor({
    command: agentProcessCommand(),
    // The agent reads configuration from the host's data dir, which may come from `--data-dir` rather than the env.
    env: () => ({ ...process.env, PROKOPAI_DATA_DIR: getDataDir() }),
    handlers: hostSide.handlers,
    notifications: hostSide.notifications,
    initialize: () => ({
      protocolVersion: PROTOCOL_VERSION,
      host: { version: serverPackage.version },
      settings: { sandboxActive: isSandboxActive(), permissionTimeoutMs: getPermissionTimeoutMs() },
    }),
    isBusy: hostSide.busy,
    idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 5 * 60_000,
    onExit: async ({ expected }) => {
      hostSide.agentExited();
      if (!expected) await recoverAfterAgentExit();
    },
  });
  const current = supervisor;
  hostSide.connect(() => current.endpoint);
  bindExecutors = registrations => hostSide.bind(registrations);
  console.info('[agent-bridge] harnesses run in a supervised agent process');
}
