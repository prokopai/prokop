import { existsSync } from 'node:fs';
import { createPullRequestsApplication, type PullRequestsApplication } from '@/application/pull-requests';
import { createProkopPullRequestsPort } from '@/adapters/prokop/pull-requests';
import { createCliPullRequestProviders } from '@/infrastructure/pull-requests';
import {
  createAgentsApplication,
  createFilesApplication,
  createMcpHttpApplication,
  createProvidersApplication,
  createSchedulingHttpApplication,
  createSchedulingTicker,
  withScheduledJobChangeNotices,
  createSessionApplication,
  createSessionControlApplication,
  createSessionHttpApplication,
  createSessionTitleRegeneration,
  createToolsHttpApplication,
  createWorkspaceApplication,
  createWorktreeApplication,
  createPermissionsApplication,
  createConfigurationApplication,
  createMaintenanceApplication,
  createResponseFormatsApplication,
  type AgentsApplication,
  type FilesApplication,
  type McpHttpApplication,
  type NotificationsApplication,
  type PermissionsApplication,
  type ProvidersApplication,
  type SchedulingHttpApplication,
  type SchedulingTicker,
  type SessionApplication,
  type SessionControlApplication,
  type SessionHttpApplication,
  type ToolsHttpApplication,
  type WorkspaceApplication,
  type WorktreeApplication,
  type ConfigurationApplication,
  type MaintenanceApplication,
  type ResponseFormatsApplication,
} from '@/application';
import { createProkopProviderRegistryPort } from '@/adapters/providers/runtime-registry';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { switchSessionHarnessModel } from '@/infrastructure/sqlite/session-harness-switch';
import { getModelsConfigWithStatus } from '@/config/models';
import { findModelVariantKeys } from '@prokopai/core/config';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { countMessagesInSession } from '@/infrastructure/sqlite/message-store';
import { createWorktreeGitPort } from '@/infrastructure/git-worktrees';
import { createWorktreeSetupRunner } from '@/application/worktree-setup';
import { createSessionDeliveryApplication, type SessionDeliveryApplication } from '@/application/sessions/delivery';
import { addSessionUpdatedObserver } from '@/application/sessions/updates';
import { addAskCreatedObserver } from '@/application/sessions/asks';
import { listPendingRequestsByRootSession } from '@/infrastructure/sqlite/pending-asks';
import { createDelegatedTaskStore } from '@/infrastructure/sqlite/delegated-tasks';
import { createSessionDeliveryRepository } from '@/infrastructure/sqlite/session-deliveries';
import { createWorktreeSetupRepository } from '@/infrastructure/sqlite/managed-worktree-setups';
import {
  createWorktreePortProbe,
  createWorktreeSetupCommandPort,
  createWorktreeSetupFilesPort,
  createWorktreeSetupLogPort,
} from '@/infrastructure/worktree-setup';
import {
  createProkopAgentPreconfigPort,
  createProkopAgentWorkspacePort,
  createProkopFilesApplicationPort,
  createProkopMcpLifecyclePort,
  createProkopMcpWorkspacePort,
  createProkopOAuthFlowPort,
  createProkopPendingAskPort,
  createProkopPermissionRepositoryPort,
  createProkopConfigurationPorts,
  createProkopMaintenanceApplication,
  createProkopResponseFormatsApplication,
  createProkopProviderCredentialPort,
  createProkopScheduledJobExecution,
  createProkopScheduledJobRepository,
  createProkopSessionRepository,
  createProkopToolCatalogPort,
  createProkopToolEnvironmentPort,
  createProkopWorkspaceCleanupPort,
  getProkopNotificationsApplication,
  createProkopWorkspaceDirectoryPort,
  createProkopWorkspacePathConfigPort,
  createProkopWorkspacePinnedPort,
  createProkopWorkspaceRepositoryPort,
  createProkopWorkspaceSessionListingPort,
  createProkopWorkspaceTerminalPort,
} from '@/adapters/prokop';
import { getTerminalManager, installTerminalSessionStore } from '@/transport/terminal';
import {
  broadcastEvent,
  broadcastSessionUpdated,
  broadcastToSessionEvent,
  broadcastToSessionsEvent,
  sendToAskTargetsEvent,
  sendToConnectionEvent,
  sendToControllerEvent,
} from '@/transport/websocket/broadcast';
import { installShellCompletionDelivery } from './shell-completions';
import { addWorkspaceFilesChangedObserver, notifyWorkspaceFilesChanged } from '@prokopai/core/application/workspaces/files-changed';
import { setMcpChangeListener } from '@/infrastructure/mcp';
import { harnessProbes } from '@prokopai/core/application/ports/harness-probes';
import { browserService } from '@/infrastructure/browser/service';
import { installBrowserClientsPort, installBrowserRequestsPort } from '@/application/ports/browser';
import { createBrowserClientsPort } from '@/transport/websocket/browser-clients';
import { listWorkspaces } from '@/infrastructure/sqlite/workspaces';
import { createProkopTerminalSessionPort } from '@/adapters/prokop/terminal';
import { createTransportControllerPorts } from '@/transport/websocket/control-port';
import { isAnyConnectionAttending } from '@/transport/websocket/connection-registry';
import { getControlState } from '@/transport/websocket/control-registry';
import { configureNotificationPresence } from '@/adapters/prokop/notifications';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import type { SessionWirePorts } from '@prokopai/core/application/ports/delivery';
import { createAgentDirectoryPort } from '@prokopai/core/infrastructure/agents/agent-directory-filesystem';
import { getDataDir } from '@prokopai/core/infrastructure/runtime/paths';
import { codexAccounts } from '@/infrastructure/providers/codex-accounts';
import { codexAccountRuntime } from '@/infrastructure/providers/codex';
import { createCodexAccountUsagePort } from '@/infrastructure/providers/codex-usage';
import { createProviderUsagePort } from '@/infrastructure/providers/usage';
import { getLLMApiKeys } from '@prokopai/core/infrastructure/runtime/environment';
import {
  createProkopAskAuthorityPort, createProkopLearningRuntime, codexCliAvailable, codexCliVersion, claudeCliAvailable,
  claudeCliVersion, cliWorkspaceAvailable,
} from '@prokopai/agent/host';
import { agentRuntime } from './agent-runtime';
import {
  getClaudeModelSelection, getCodexModelSelection, saveClaudeModelSelection, saveCodexModelSelection,
} from '@/infrastructure/sqlite/harness-model-selection';
import { createHarnessExecution } from '@prokopai/core/application/sessions/harness-execution';
import { onHarnessWorktreeChanged } from '@/bootstrap/agent-ports';
import { installHeadlessExecutionPort, type HeadlessSessionRunInput } from '@prokopai/core/application/ports/headless-execution';
import { installDelegationHost } from '@prokopai/core/application/ports/delegation-host';
import { installAgentMessagingHost } from '@prokopai/core/application/ports/agent-messaging';
import { agentHomeWorkspaceId } from '@prokopai/core/domains/agents/home';
import { createAgentConversationStore } from '@/infrastructure/sqlite/agent-conversations';
import { getAgentMessageMaxHops, getDelegationMaxChildren, getDelegationMaxLaunches } from '@prokopai/core/infrastructure/runtime/environment';
import { fallbackSessionTitle } from '@prokopai/core/infrastructure/session-title';
import { createHarnessSettingsApplication } from '@/application/harnesses/settings';
import { createServerSettingsRepository } from '@/infrastructure/sqlite/server-settings';
import { createDeviceAccessRepository } from '@/infrastructure/sqlite/device-access';
import { createDeviceAccessService, type DeviceAccessService } from '@/application/device-access/service';
import { createAttentionFeed, type AttentionFeed } from '@/application/attention/feed';
import { createAttentionSource } from '@/infrastructure/sqlite/attention-source';

import { createWiredLearning } from './learning';

export interface WiredApplication {
  learning: ReturnType<typeof createWiredLearning>;
  session: SessionApplication<ConnectionId>;
  control: SessionControlApplication<ConnectionId>;
  http: SessionHttpApplication;
  scheduling: SchedulingHttpApplication;
  /** The wired scheduled-job tick loop owned by the application composition. */
  schedulerTicker: SchedulingTicker;
  /** The wired agent promotion, home, and memory use cases (S4). */
  agents: AgentsApplication;
  /** The wired workspace record and cleanup use cases (S4). */
  workspaces: WorkspaceApplication;
  /** Managed session worktree lifecycle and binding use cases. */
  worktrees: WorktreeApplication;
  /** Server-originated messages to sessions: task results, agent messages, catch-ups. */
  sessionDelivery: SessionDeliveryApplication;
  /** The wired tools catalog and environment use cases (S4). */
  tools: ToolsHttpApplication;
  /** The wired MCP lifecycle use cases (S5). */
  mcp: McpHttpApplication;
  /** The wired provider account and OAuth use cases (S4). */
  providers: ProvidersApplication;
  /** The wired notification reservation and delivery use cases (S4). */
  notifications: NotificationsApplication;
  /** The wired permission grant application. */
  permissions: PermissionsApplication;
  /** The wired files list/search/preview/edit/git use cases (S5). */
  files: FilesApplication;
  pullRequests: PullRequestsApplication;
  /** The wired configuration use cases (S9). */
  configuration: ConfigurationApplication;
  maintenance: MaintenanceApplication;
  responseFormats: ResponseFormatsApplication;
  /** Device pairing, approval requests, and device sessions. */
  deviceAccess: DeviceAccessService;
  /** Pending approvals, questions, and running sessions, streamed to every client. */
  attention: AttentionFeed;
}

/**
 * Wired application composition (S3, extended by the S4 scheduling slice).
 *
 * Assembles the session and control use cases with concrete Jean2 ports:
 * the store-backed repository adapter, the Capek compat execution adapter,
 * the transport-owned controller gate and control registry, and the current
 * takeover configuration. The S4 scheduling slice adds the scheduled-job
 * HTTP use cases and the tick loop over the store-backed scheduled-job
 * repository adapter, the storage workspace lookup, and the current runner
 * execution adapter. The composed ticker is returned for direct startup and
 * shutdown lifecycle calls; use cases never import store or Capek
 * implementations themselves.
 */
export function createWiredAgentsApplication(): AgentsApplication {
  return createAgentsApplication({
    dataDir: () => getDataDir(),
    directory: createAgentDirectoryPort(),
    workspaces: createProkopAgentWorkspacePort(),
    preconfigs: createProkopAgentPreconfigPort(),
  });
}

export function createWiredApplication(existingAgents?: AgentsApplication): WiredApplication {
  // Notifications read who is looking and who controls a session from the WebSocket registries.
  configureNotificationPresence({
    isAnyClientAttending: () => isAnyConnectionAttending(),
    controllerClientId: (sessionId) => getControlState(sessionId).controllerClientId,
  });
  installBrowserRequestsPort(browserService);
  installBrowserClientsPort(createBrowserClientsPort((requestId, sessionId) =>
    getProkopNotificationsApplication().notifyAnswerRequired(requestId, sessionId)));
  setMcpChangeListener(path => {
    if (path === null) {
      broadcastEvent({ type: 'mcp.changed', workspaceId: null });
      return;
    }
    for (const workspace of listWorkspaces()) {
      if (workspace.path === path) broadcastEvent({ type: 'mcp.changed', workspaceId: workspace.id });
    }
  });
  const agents = existingAgents ?? createWiredAgentsApplication();
  const repository = createProkopSessionRepository(agents);
  let refreshWorktreeAttachments: ((worktreeId: string) => void) | null = null;
  const worktreeAttachments = {
    changed: (worktreeId: string): void => refreshWorktreeAttachments?.(worktreeId),
  };
  // The Prokop harness reports worktree session changes through the harness notification port.
  onHarnessWorktreeChanged(worktreeAttachments.changed);
  const harnessRegistrations = inProcessHarnessRegistrations(agents, repository);
  const execution = createHarnessExecution(repository, harnessRegistrations);
  // Background shell commands report back through the session's own turn flow.
  const shellCommands = installShellCompletionDelivery({
    runtime: agentRuntime(),
    repository,
    execution,
    delivery: {
      broadcast: broadcastEvent,
      broadcastToSession: broadcastToSessionEvent,
      sendToController: sendToControllerEvent,
      sendToAskTargets: sendToAskTargetsEvent,
    },
  });
  // Server features (delegation results, agent messages, group catch-ups)
  // reach a session's model only through this primitive; it persists what a
  // session cannot take yet and retries on the session's next idle update.
  const sessionDelivery = createSessionDeliveryApplication<ConnectionId>({
    repository: createSessionDeliveryRepository(getDatabase),
    sessions: repository,
    execution,
    delivery: {
      broadcast: broadcastEvent,
      broadcastToSession: broadcastToSessionEvent,
      sendToController: sendToControllerEvent,
      sendToAskTargets: sendToAskTargetsEvent,
    },
    originFor: (key) => `delivery:${key}` as ConnectionId,
  });
  addSessionUpdatedObserver(sessionDelivery.onSessionUpdated);
  // Headless (scheduled) dispatch routes through the harness registry: the
  // Prokop registration owns the composed-scope child run; harnesses
  // without headless support fail closed per run and are rejected at job
  // creation through supportedHarnesses().
  /**
   * A delegated child on a CLI harness takes the role's pinned model the
   * same way a new session does: validated against the live CLI catalog,
   * with the role's variant as effort when the model supports it. An
   * unknown model or an unavailable catalog leaves the CLI default.
   */
  const pinDelegatedChildModel = async (input: HeadlessSessionRunInput): Promise<void> => {
    if (input.harness === 'prokop' || !input.modelId) return;
    try {
      const models = await harnessProbes().models(input.harness);
      const entry = models.find(model => model.model === input.modelId);
      if (!entry) return;
      const variant = input.preconfig.variant ?? '';
      const effort = entry.supportedEfforts.includes(variant) ? variant : entry.defaultEffort;
      if (input.harness === 'codex-cli') saveCodexModelSelection(input.childSessionId, { model: entry.model, effort });
      else saveClaudeModelSelection(input.childSessionId, { model: entry.model, effort });
    } catch {
      // CLI catalog unavailable on this host: the CLI default applies.
    }
  };
  // A delegated child runs visibly: its session's clients and the parent's
  // follow the turn (clients watch a child from the session that started it),
  // and a parent that stops interrupts it through the normal path.
  const visibleWireFor = (parentSessionId: string): SessionWirePorts<unknown> => ({
    delivery: {
      send: () => {},
      broadcast: (message) => broadcastEvent(message),
      broadcastToSession: (sessionId, message) => broadcastToSessionsEvent([sessionId, parentSessionId], message),
      sendToController: (sessionId, message) => sendToControllerEvent(sessionId, message),
      sendToAskTargets: (sessionId, authority, message) => sendToAskTargetsEvent(sessionId, authority, message),
    },
    actor: { attachOriginToSession: () => {} },
  });
  installHeadlessExecutionPort({
    async run(input, options) {
      const headless = harnessRegistrations[input.harness]?.headless;
      if (!headless) return { error: `Scheduled jobs are not supported for ${input.harness} sessions` };
      const signal = options?.signal;
      const interrupt = (): void => {
        void execution.interruptSession(input.childSessionId, 'Parent session stopped').catch(() => undefined);
      };
      if (signal?.aborted) interrupt();
      else signal?.addEventListener('abort', interrupt, { once: true });
      try {
        if (options?.visible) await pinDelegatedChildModel(input);
        return await headless(input, options?.visible ? { ...options, wire: visibleWireFor(input.parentSessionId) } : options);
      } finally {
        signal?.removeEventListener('abort', interrupt);
      }
    },
    supportedHarnesses() {
      return (Object.keys(harnessRegistrations) as Array<import('@prokopai/sdk').SessionHarness>)
        .filter(harness => harnessRegistrations[harness].headless !== undefined);
    },
  });
  const askAuthority = createProkopAskAuthorityPort();
  const pendingAsks = createProkopPendingAskPort();
  const transportControl = createTransportControllerPorts();
  const toolCatalog = createProkopToolCatalogPort();
  const managedWorktrees = createManagedWorktreeRepository(getDatabase);
  const worktreeGit = createWorktreeGitPort();
  let worktreesRef: WorktreeApplication | null = null;
  const harnessSettings = createHarnessSettingsApplication(createServerSettingsRepository(getDatabase));
  // What a delegation checks before creating a child: the harness is enabled
  // here and installed on this machine, and the root is under its child limit.
  // Agent messaging: conversations in recipient homes, messages and answers
  // through the delivery primitive, the recipient's home materialized on
  // first contact.
  const agentConversations = createAgentConversationStore(getDatabase);
  installAgentMessagingHost({
    deliver: async ({ sessionId, content, key }) => {
      await sessionDelivery.deliver({ sessionId, content, key, origin: 'agent' });
    },
    homeWorkspace: async (agentId) => {
      const agent = await agents.ensureAgentMaterialized(agentId);
      if (!agent?.hasHome) return null;
      const workspace = getWorkspace(agentHomeWorkspaceId(agentId));
      return workspace ? { id: workspace.id, path: workspace.path } : null;
    },
    maxHops: getAgentMessageMaxHops,
    conversations: agentConversations,
  });

  installDelegationHost({
    harnessEnabled: harness => harness === 'prokop' || !harnessSettings.isDisabled(harness),
    harnessAvailable: harness => harness === 'prokop' ? true : harness === 'codex-cli' ? codexCliAvailable() : claudeCliAvailable(),
    maxChildren: getDelegationMaxChildren,
    // After the parent stops waiting: results and ask wake-ups travel as
    // deliveries; a cancel is the normal session interrupt.
    deliver: async ({ sessionId, content, key }) => {
      await sessionDelivery.deliver({ sessionId, content, key, origin: 'delegation' });
    },
    onAskCreated: addAskCreatedObserver,
    hasPendingAsk: sessionId => listPendingRequestsByRootSession(sessionId).length > 0,
    interrupt: async (sessionId, reason) => {
      await execution.interruptSession(sessionId, reason);
    },
    tasks: createDelegatedTaskStore(getDatabase),
    maxLaunches: getDelegationMaxLaunches,
    // Launches: a worktree on a fresh branch through the worktree application
    // (created below; every call happens long after wiring).
    worktrees: {
      currentBranch: async (workspaceId) => {
        const refs = await worktreesRef?.listRefs(workspaceId);
        return refs?.ok ? refs.value.find(ref => ref.current)?.name ?? null : null;
      },
      createWorktree: async ({ workspaceId, branch, baseBranch }) => {
        if (!worktreesRef) return { ok: false, error: 'Worktrees are unavailable' };
        const refs = await worktreesRef.listRefs(workspaceId);
        if (!refs.ok) return { ok: false, error: refs.message };
        const taken = new Set(refs.value.map(ref => ref.name));
        let name = branch;
        for (let suffix = 2; taken.has(name); suffix += 1) name = `${branch}-${suffix}`;
        const created = await worktreesRef.create(workspaceId, { name, branch: `refs/heads/${name}`, createBranchFrom: baseBranch });
        if (!created.ok) return { ok: false, error: created.message };
        return { ok: true, worktreeId: created.value.id, path: created.value.path, branch: created.value.branch ?? name };
      },
      worktreeChanges: async (worktreeId) => {
        const record = managedWorktrees.get(worktreeId);
        if (!record) return null;
        try {
          const status = await worktreeGit.status(record.path);
          return { changedFiles: status.changedCount ?? 0, branch: status.branch ?? record.branch, path: record.path };
        } catch {
          return null;
        }
      },
    },
  });
  // Shared by both CLI harnesses: the same rule their turns enforce, plus the folder must exist.
  const codexWorkspaceAvailable = (workspaceId: string): boolean => {
    const workspace = getWorkspace(workspaceId);
    return cliWorkspaceAvailable(workspace) && existsSync(workspace.path);
  };
  const workspaceRoots = {
    isAvailable(workspaceId: string, workspaceRootId: string): boolean {
      const worktree = managedWorktrees.get(workspaceRootId);
      return worktree?.workspaceId === workspaceId && worktree.state === 'available';
    },
  };
  const worktreeRoots = {
    listAvailablePaths: (workspaceId: string): string[] => managedWorktrees.listByWorkspace(workspaceId)
      .filter((worktree) => worktree.state === 'available')
      .map((worktree) => worktree.path),
    getAvailablePath: (workspaceId: string, worktreeId: string): string | null => {
      const worktree = managedWorktrees.get(worktreeId);
      return worktree?.workspaceId === workspaceId && worktree.state === 'available'
        ? worktree.path
        : null;
    },
  };

  const session = createSessionApplication<ConnectionId>({
    repository,
    execution,
    gate: transportControl.gate,
    control: transportControl.control,
    pendingAsks,
    askAuthority,
    toolCatalog,
    workspaceRoots,
    worktreeAttachments,
    stopBackgroundWork: shellCommands.stopBackgroundWork,
    agentConversations,
    codexAvailable: codexCliAvailable,
    codexWorkspaceAvailable,
    claudeAvailable: claudeCliAvailable,
    claudeWorkspaceAvailable: codexWorkspaceAvailable,
    claudeModels: () => harnessProbes().models('claude-cli'),
    codexModels: () => harnessProbes().models('codex-cli'),
    saveHarnessModelSelection: (sessionId, selection) => {
      if (selection.harness === 'codex-cli') saveCodexModelSelection(sessionId, selection);
      else saveClaudeModelSelection(sessionId, selection);
    },
    isHarnessDisabled: harnessSettings.isDisabled,
    prokopModelAvailable: (modelId, providerId) => getModelsConfigWithStatus().providers
      .some(provider => provider.id === providerId && provider.models.some(model => model.id === modelId && model.runtimeStatus.usable)),
    modelVariantKeys: findModelVariantKeys,
    switchSessionHarnessModel,
  });

  const control = createSessionControlApplication<ConnectionId>({
    control: transportControl.control,
  });

  const http = createSessionHttpApplication(
    repository,
    toolCatalog,
    workspaceRoots,
    worktreeAttachments,
    codexCliAvailable,
    codexWorkspaceAvailable,
    { list: () => harnessProbes().models('codex-cli'), get: getCodexModelSelection, save: saveCodexModelSelection,
      isActive: harnessRegistrations['codex-cli'].execution.isSessionActive },
    claudeCliAvailable,
    { list: () => harnessProbes().models('claude-cli'), get: getClaudeModelSelection, save: saveClaudeModelSelection,
      isActive: harnessRegistrations['claude-cli'].execution.isSessionActive },
    codexWorkspaceAvailable,
    { settings: harnessSettings, codexVersion: codexCliVersion, claudeVersion: claudeCliVersion,
      usage: { 'codex-cli': () => harnessProbes().usageLimits('codex-cli'),
        'claude-cli': () => harnessProbes().usageLimits('claude-cli') } },
    {
      created: (session) => broadcastEvent({ type: 'session.created', session }),
      updated: broadcastSessionUpdated,
      deleted: (sessionId) => {
        shellCommands.stopBackgroundWork(sessionId);
        broadcastEvent({ type: 'session.deleted', sessionId });
      },
    },
  );

  // Every job write (edits, runs, errors, schedule advances) tells clients to refetch that workspace's jobs.
  const schedulingRepository = withScheduledJobChangeNotices(createProkopScheduledJobRepository(),
    (workspaceId) => broadcastEvent({ type: 'scheduler.changed', workspaceId }));
  // Scheduled runs create sessions outside any connection; announce them to every client.
  const schedulingExecution = createProkopScheduledJobExecution({
    announceSession: broadcastSessionUpdated,
    runs: schedulingRepository,
  });

  const scheduling = createSchedulingHttpApplication({
    repository: schedulingRepository,
    workspaces: {
      getWorkspace,
    },
    execution: schedulingExecution,
    runs: {
      listRunSessionIds: (workspaceId, jobId) => repository
        .listSessionsByWorkspace(workspaceId, { category: 'scheduled' })
        .filter((session) => session.metadata?.scheduledJobId === jobId)
        .map((session) => session.id),
      deleteSession: (id) => http.deleteSession(id),
    },
    isHarnessDisabled: harnessSettings.isDisabled,
  });

  const schedulerTicker = createSchedulingTicker({
    repository: schedulingRepository,
    execution: schedulingExecution,
  });

  const workspaces = createWorkspaceApplication({
    repository: createProkopWorkspaceRepositoryPort(),
    sessions: createProkopWorkspaceSessionListingPort(),
    pinned: createProkopWorkspacePinnedPort(),
    terminals: createProkopWorkspaceTerminalPort(),
    cleanup: createProkopWorkspaceCleanupPort(),
    directory: createProkopWorkspaceDirectoryPort(),
    paths: createProkopWorkspacePathConfigPort(),
    worktreeRoots,
  });

  const worktrees = createWorktreeApplication({
    dataDir: () => getDataDir(),
    repository: managedWorktrees,
    git: worktreeGit,
    setup: createWorktreeSetupRunner({
      files: createWorktreeSetupFilesPort(),
      ports: createWorktreePortProbe(),
      repository: createWorktreeSetupRepository(getDatabase),
      commands: createWorktreeSetupCommandPort(),
      log: createWorktreeSetupLogPort(() => getDataDir()),
      // Every setup state change rebroadcasts the worktree (same path as
      // attachment refreshes; the application is created just below) and
      // tells the file tree and Git status feeds that the worktree's files
      // moved: copies, env files, a finished install. The feeds refresh the
      // roots clients watch, so the Explorer follows without a manual reload.
      onChanged: (worktreeId) => {
        refreshWorktreeAttachments?.(worktreeId);
        const record = managedWorktrees.get(worktreeId);
        if (record) notifyWorkspaceFilesChanged(record.workspaceId);
      },
      worktreePath: (worktreeId) => managedWorktrees.get(worktreeId)?.path ?? null,
    }),
    workspaces: { get: getWorkspace },
    sessions: {
      get: (id) => repository.getSession(id),
      listByWorkspace: (workspaceId) => repository.listSessionsByWorkspace(workspaceId),
      updateWorkspaceRoot: (id, workspaceRootId) => repository.updateSession(id, { workspaceRootId }),
      hasMessages: (sessionId) => countMessagesInSession(sessionId) > 0,
      isRunning: (candidate) => Boolean(candidate.runningAt || candidate.subagentStatus === 'running'),
    },
    terminals: {
      listForWorktree: (worktreeId, path) => getTerminalManager().listSessionsForWorktree(worktreeId, path),
      clearWorktreeReferences: (worktreeId) => getTerminalManager().clearWorktreeReferences(worktreeId),
    },
    events: {
      worktreeChanged: (worktree) => broadcastEvent({ type: 'worktree.updated', worktree }),
      worktreeDeleted: (worktree) => broadcastEvent({ type: 'worktree.deleted', worktree }),
      sessionChanged: broadcastSessionUpdated,
    },
  });
  refreshWorktreeAttachments = (worktreeId) => {
    void worktrees.refreshAttachments(worktreeId);
  };
  worktreesRef = worktrees;

  const tools = createToolsHttpApplication({
    catalog: toolCatalog,
    environment: createProkopToolEnvironmentPort(),
  });

  const mcp = createMcpHttpApplication({
    lifecycle: createProkopMcpLifecyclePort(),
    workspaces: createProkopMcpWorkspacePort(),
  });

  codexAccounts.setChangeListener(status => broadcastEvent({
    type: 'provider.status', provider: 'codex', connected: status.connected,
    reauthRequired: status.reauthRequired,
  }));
  const providers = createProvidersApplication({
    usage: createProviderUsagePort({ getKey: provider => getLLMApiKeys()[provider] }),
    registry: createProkopProviderRegistryPort(),
    oauth: createProkopOAuthFlowPort(),
    credentials: createProkopProviderCredentialPort(),
    accounts: codexAccounts,
    codexUsage: createCodexAccountUsagePort({ accounts: codexAccounts, runtime: codexAccountRuntime }),
  });

  const notifications = getProkopNotificationsApplication();
  // A conversation's finished turn answers the agent that asked.
  notifications.onTerminalMessage((message) => { void agentRuntime().returnAgentMessageAnswer(message); });

  const permissions = createPermissionsApplication({
    repository: createProkopPermissionRepositoryPort(),
  });

  const filesPort = createProkopFilesApplicationPort({
    listAvailableWorktreePaths: worktreeRoots.listAvailablePaths,
  });
  const pullRequests = createPullRequestsApplication(createProkopPullRequestsPort(
    filesPort,
    (workspaceId, repositoryKey) => broadcastEvent({ type: 'pull-request.changed', workspaceId, repositoryKey }),
    createCliPullRequestProviders(),
  ));
  const files = createFilesApplication(filesPort, (workspaceId, root) => broadcastEvent({ type: 'git.changed', workspaceId, root }), {
    deliverGitStatus: (subscriber, message) => sendToConnectionEvent(subscriber as ConnectionId, message),
    deliverFileTree: (subscriber, message) => sendToConnectionEvent(subscriber as ConnectionId, message),
  });
  // Tool completions that may write files refresh subscribed Git status and trees, throttled per root.
  addWorkspaceFilesChangedObserver((workspaceId) => files.gitStatusFeed.filesChanged(workspaceId));
  addWorkspaceFilesChangedObserver((workspaceId) => files.fileTreeFeed.filesChanged(workspaceId));
  addWorkspaceFilesChangedObserver((workspaceId) => files.searchFilesChanged(workspaceId));
  const configuration = createConfigurationApplication({
    ...createProkopConfigurationPorts(),
    // Primary/both preconfigs materialize as agents on save. Materialization
    // failure must not fail an otherwise-successful config write.
    onPreconfigSaved: async (preconfigId) => {
      try {
        await agents.ensureAgentMaterialized(preconfigId);
      } catch (error: unknown) {
        console.warn(`[agents] Failed to materialize agent for preconfig ${preconfigId}:`, error);
      }
    },
  });
  const maintenance = createMaintenanceApplication(createProkopMaintenanceApplication());
  const responseFormats = createResponseFormatsApplication(createProkopResponseFormatsApplication());

  installTerminalSessionStore(createProkopTerminalSessionPort());

  const deviceAccess = createDeviceAccessService({ repository: createDeviceAccessRepository(getDatabase) });
  // Admin clients refetch pending requests and devices on this event; it carries no secrets.
  deviceAccess.subscribe({ changed: () => broadcastEvent({ type: 'access.changed' }) });
  const attention = createAttentionFeed({ source: createAttentionSource(getDatabase) });

  return { learning: createWiredLearning(agents, createProkopLearningRuntime(), {
    // Harness-pinned reviewers resolve their effort from the cached CLI
    // catalogs (unsupported pinned effort falls back to the model default);
    // a missing CLI or model yields null and the cycle skips silently.
    harnessModelEffort: async (harness, model, variant) => {
      try {
        const models = await harnessProbes().models(harness);
        const entry = models.find(candidate => candidate.model === model);
        if (!entry) return null;
        return entry.supportedEfforts.includes(variant ?? '') ? variant! : entry.defaultEffort;
      } catch {
        return null;
      }
    },
    saveHarnessSelection: (harness, sessionId, model, effort) => {
      if (harness === 'codex-cli') saveCodexModelSelection(sessionId, { model, effort });
      else saveClaudeModelSelection(sessionId, { model, effort });
    },
  }), session, control, http, scheduling, schedulerTicker, agents, workspaces, worktrees, sessionDelivery, tools, mcp, providers, notifications, permissions, files, pullRequests, configuration, maintenance, responseFormats, deviceAccess, attention };
}

/**
 * The harnesses, run in this process. The Prokop
 * runtime and the CLI drivers load here, on demand. CLI titles use the
 * universal server-side regeneration; Claude Code writes its own session
 * title, so Claude sessions get one without a Prokop model.
 */
function inProcessHarnessRegistrations(
  agents: AgentsApplication, repository: ReturnType<typeof createProkopSessionRepository>,
): ReturnType<ReturnType<typeof agentRuntime>['createHarnessRegistrations']> {
  const agent = agentRuntime();
  agent.configureProkopPreconfigSource(agents);
  agent.configureProkopAgentSource(agents);
  const sessionTitles = { repository, titles: { ...agent.prokopTitleBindings, fallbackSessionTitle } };
  return agent.createHarnessRegistrations({ agents, titles: {
    prokop: createSessionTitleRegeneration(sessionTitles),
    'codex-cli': createSessionTitleRegeneration(sessionTitles),
    'claude-cli': createSessionTitleRegeneration({ ...sessionTitles,
      harnessTitle: sessionId => harnessProbes().nativeTitle(sessionId) }),
  } });
}
