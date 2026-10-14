import { fileURLToPath } from 'node:url';
import {
  PROTOCOL_VERSION, type AgentHandlers, type AgentSide, type HostEndpoint, type HostHandlers, type NotificationHandlers,
} from '@prokopai/agent-protocol';
import { createAgentSupervisor, type AgentSupervisor } from '@/agent-bridge/agent-supervisor';
import { readEnv } from '@prokopai/core/infrastructure/runtime/env-compat';
import serverPackage from '@/../package.json' with { type: 'json' };
import { recoverAfterAgentExit } from './agent-recovery';
import type { SessionHarness } from '@prokopai/sdk';
import { installHarnessNotificationPort, type HarnessNotificationPort } from '@prokopai/core/application/ports/harness-notifications';
import type { AgentExecutor, AgentHeadlessRun } from '@prokopai/agent';
import { executeMemoryTool, executeSkillManageTool, getSessionSearchHost, harnessCapabilities } from '@prokopai/agent/host';
import { agentRuntime } from './agent-runtime';
import { codexAccountRuntime } from '@/infrastructure/providers/codex';
import { prokopInteractionBindings } from '@/adapters/prokop/runtime-host/interaction';
import { prokopWorkspaceBindings } from '@/adapters/prokop/runtime-host/workspace';
import type { HarnessExecutor, HarnessRegistration } from '@prokopai/core/application/sessions/harness-execution';
import { createTurnForwarding } from '@/agent-bridge/host-turns';
import { createProtocolHarnessProbes } from '@/agent-bridge/host-probes';
import { configureHarnessProbes } from '@prokopai/core/application/ports/harness-probes';
import type { HarnessOperation } from '@prokopai/core/application/sessions/harness-execution';
import { isKnowledgeDirectory } from './knowledge-directories';
import { createRuntimeHostHandlers } from '@/agent-bridge/host-runtime';
import { createStorageHostHandlers } from '@/agent-bridge/host-storage';
import { createToolHostHandlers, type SessionSearchService, type TerminalAccess } from '@/agent-bridge/host-tools';
import { agentLoopbackEnabled, agentProcessEnabled, createAgentLoopback } from '@/agent-bridge/loopback';
import { getProkopNotificationsApplication } from '@/adapters/prokop/notifications';
import { prokopMcpAccess } from '@/adapters/prokop/runtime-host/tool-source';
import { getWorkspaceTools } from '@/infrastructure/mcp/manager';
import { getPermissionTimeoutMs } from '@prokopai/core/infrastructure/runtime/environment';
import { getRuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { getDataDir } from '@prokopai/core/infrastructure/runtime/paths';
import { storedWorkspaceKnowledgeRoot } from '@/infrastructure/sqlite/workspace-knowledge-root';
import { isSandboxActive } from '@prokopai/core/infrastructure/sandbox';
import { sandboxController } from '@prokopai/core/infrastructure/sandbox/controller';
import type { LlmCallContext } from '@prokopai/core/infrastructure/sandbox/types';
import { addWorkspaceAdditionalPath, removeWorkspaceAdditionalPath } from '@/infrastructure/sqlite/workspaces';
import { getStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { getTerminalManager } from '@/transport/terminal';
import {
  broadcastEvent, broadcastToSessionEvent, sendToAskTargetsEvent, sendToControllerEvent,
} from '@/transport/websocket/broadcast';
import { configureHarnessAsks } from '@prokopai/core/infrastructure/runtime/harness-asks';
import { createHarnessAskHandlers, protocolAgentAsks } from '@/agent-bridge/host-asks';
import { localHarnessAsks } from './harness-asks';
import { installAgentAskPort, isNativeHarnessAskId } from '@prokopai/core/application/ports/agent-asks';
import { configureHarnessMcpTools } from '@prokopai/core/application/ports/mcp-tools';
import { installLearningReviewToolPort } from '@prokopai/core/application/ports/learning-review-tools';
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
  // Host services directly: process mode installs no in-process runtime host.
  const hostSessionSearch = getSessionSearchHost();
  const resolveSessionWorkspace = prokopWorkspaceBindings.resolveSessionWorkspace;
  if (!resolveSessionWorkspace) throw new Error('Agent protocol needs a host session workspace resolver');
  let endpoint: (() => HostEndpoint) | null = null;
  const host = (): HostEndpoint => {
    if (!endpoint) throw new Error('No agent connected');
    return endpoint();
  };

  const runtime = createRuntimeHostHandlers({
    interaction: prokopInteractionBindings,
    resolveSessionWorkspace,
    knowledgeRoot: storedWorkspaceKnowledgeRoot,
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
  // Claude Code and Codex waiters live in the connected agent: the host knows which ones it opened.
  const liveNativeAsks = new Set<string>();
  const createPendingAsk = runtime.handlers['interaction.createPendingAsk']!;

  return {
    handlers: {
      ...createStorageHostHandlers(hostStorage), ...runtime.handlers, ...tools,
      ...createHarnessAskHandlers(localHarnessAsks),
      'interaction.createPendingAsk': async (params, context) => {
        const created = await createPendingAsk(params, context);
        const record = params.record as { toolCallId?: string; requestId?: string };
        if (record.requestId && record.toolCallId && isNativeHarnessAskId(record.toolCallId)) liveNativeAsks.add(record.requestId);
        return created;
      },
      'learning.tool': async ({ sessionId, name, arguments: input }) => ({ ...await learningReviewTools.call(sessionId, name, input) }),
      'provider.codexCredentials': ({ accountId, rejectedRevision }) =>
        codexAccountRuntime.credentialsFor(accountId, rejectedRevision),
      'sandbox.call': async ({ context }, { signal }) =>
        ({ ...await sandboxController.waitForResponse(context as unknown as LlmCallContext, signal) }),
    },
    notifications: {
      ...runtime.notifications, ...turns.notifications,
      'sandbox.completed': ({ callId }) => sandboxController.complete(callId),
    },
    busy: turns.busy,
    agentExited() {
      liveNativeAsks.clear();
      turns.agentExited();
    },
    connect(next) {
      endpoint = next;
      configureHarnessProbes(createProtocolHarnessProbes(host));
      installAgentAskPort(protocolAgentAsks({
        lookup: (toolCallId, requestId) => host().request('ask.lookup', { toolCallId, requestId }),
        resolve: async answer => (await host().request('ask.resolve', answer)).resolved,
        hasLiveRequest: requestId => liveNativeAsks.has(requestId),
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
  configureHarnessAsks(localHarnessAsks);
  configureHarnessMcpTools({ tools: getWorkspaceTools });
  if (agentProcessEnabled()) {
    configureAgentProcess();
    return;
  }
  // The harnesses run in this process: their own ports point at the host directly.
  const runtime = agentRuntime();
  runtime.configureAgentTerminals(terminalPortFromManager(getTerminalManager));
  runtime.configureKnowledgeWrites(null);
  if (!agentLoopbackEnabled()) {
    installAgentAskPort(runtime.directAgentAsks);
    installLearningReviewToolPort(learningReviewTools);
    installHarnessNotificationPort(localHarnessNotifications);
    configureHarnessProbes(runtime.localHarnessProbes);
    bindExecutors = registrations => registrations;
    return;
  }

  const hostSide = createAgentHostSide();
  const local = getRuntimeHost();
  const agentHandlers: AgentHandlers = {};
  const { agent, host } = createAgentLoopback({ handlers: hostSide.handlers, notifications: hostSide.notifications },
    agentHandlers);
  hostSide.connect(() => host);
  const agentSide = runtime.composeAgentSide(agent, agentHandlers, local, { isSandboxActive, getPermissionTimeoutMs });
  bindExecutors = (registrations) => {
    agentSide.registerExecutors(registrations);
    return hostSide.bind(registrations);
  };
  console.info('[agent-bridge] harness storage, asks, runtime host and host tools run through the agent protocol loopback');
}

/**
 * The registrations the host routes to an agent process: each harness's shape
 * from `harnessCapabilities`. No harness is built in the host; every call is
 * forwarded (`bindHarnessExecutors`), so these placeholders never run.
 */
export function agentProcessRegistrations(): Record<SessionHarness, HarnessRegistration> {
  const inAgent = (operation: string) => (): never => {
    throw new Error(`${operation} runs in the agent process`);
  };
  return Object.fromEntries(Object.entries(harnessCapabilities).map(([harness, capabilities]) => {
    const execution: HarnessExecutor = {
      sendMessage: inAgent('sendMessage'), interruptSession: inAgent('interruptSession'), isSessionActive: () => false,
    };
    for (const operation of capabilities.operations) (execution as Record<string, unknown>)[operation] = inAgent(operation);
    return [harness, { execution, ...(capabilities.headless ? { headless: inAgent('headless') } : {}) }];
  })) as Record<SessionHarness, HarnessRegistration>;
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
