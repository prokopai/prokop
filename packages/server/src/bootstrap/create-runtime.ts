import { configureProkopSessionSearchHost } from '@/adapters/prokop/runtime-host/session-search';
import { configureProkopStorage } from '@/adapters/prokop/runtime-host/storage';
import { configureProkopWorkspaceToolDiscovery } from '@/adapters/prokop/runtime-host/tool-source';
import { agentProcessEnabled } from '@/agent-bridge/loopback';
import { agentBuiltinTools, agentRuntime, inProcessBindings } from './agent-runtime';
import type { ProkopSessionSearchHostDeps } from '@/adapters/prokop/runtime-host/session-search';
import { createWiredAgentsApplication } from '@/bootstrap/application';
import type { AgentsApplication } from '@prokopai/core/application/agents';
import { installExecutionLifecyclePort } from '@/application/ports/execution-lifecycle';
import { installBuiltinToolsPort } from '@prokopai/core/application/ports/builtin-tools';
import { createProkopSessionRepository } from '@/adapters/prokop/session-repository';
import { createSessionSearchQueryRepository } from '@/infrastructure/sqlite/session-search-query-repository';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { configureAgentPorts } from '@/bootstrap/agent-ports';
import { configureWorkspaceKnowledgeRoot } from '@prokopai/core/infrastructure/runtime/workspace-dirs';
import { storedWorkspaceKnowledgeRoot } from '@/infrastructure/sqlite/workspace-knowledge-root';

/** S5 session-search host dependencies. The query port is the SQLite
 * infrastructure repository with an injected store accessor; session and
 * workspace lookups come from the existing repository and storage adapter
 * implementations. */
function createSessionSearchHostDeps(agents: AgentsApplication): ProkopSessionSearchHostDeps {
  const sessionRepository = createProkopSessionRepository(agents);
  return {
    // Bootstrap is the composition root: it injects the concrete store
    // accessor; the repository holds no module-global connection state.
    query: createSessionSearchQueryRepository(() => getDatabase()),
    sessions: {
      getSession: (id) => sessionRepository.getSession(id),
      listWorkspaceSessions: (workspaceId) =>
        sessionRepository.listSessionsByWorkspace(workspaceId, { rootOnly: true }),
      listAgentSessions: (agentId, limit) =>
        sessionRepository.listSessionsByAgent(agentId, limit),
    },
    workspaces: {
      getWorkspace,
    },
  };
}

/**
 * Explicit Jean2 server composition root.
 *
 * This module assembles the focused Čapek adapters in the order established by
 * the legacy adapter composition. It owns ordering only; every adapter value,
 * fallback, and policy rule lives in its focused `harnesses/prokop/host` module. The
 * session-search host must be configured before the compatibility bindings so
 * the explicit unscoped fallback captures the configured host.
 */
export function createRuntime(existingAgents?: AgentsApplication): AgentsApplication {
  const agents = existingAgents ?? createWiredAgentsApplication();
  // The agent runs the harnesses in its own process (PROKOPAI_AGENT_PROCESS=1):
  // this process then loads no agent code (bootstrap/agent-runtime.ts).
  const runtime = agentProcessEnabled() ? null : agentRuntime();

  // The Prokop harness owns the built-in tools; the host's tool catalog reads
  // them through this port, loading them on the first read.
  installBuiltinToolsPort({ tools: () => agentBuiltinTools() });

  configureProkopStorage();
  // Managed worktrees share their workspace's knowledge; the host looks them up in its store.
  configureWorkspaceKnowledgeRoot(storedWorkspaceKnowledgeRoot);
  if (runtime) {
    runtime.configureProkopRuntimeConfiguration();
    runtime.configureProkopWorkspacePolicy();
    runtime.configureProkopPreconfigSource(agents);
    runtime.configureProkopAgentSource(agents);
    runtime.configureProkopInstructionSource();
  }
  configureProkopSessionSearchHost(createSessionSearchHostDeps(agents));
  configureProkopWorkspaceToolDiscovery();
  if (runtime) {
    void runtime.warmInstalledToolsCache();
    inProcessBindings().configureProkopBindings();
  }
  configureAgentPorts();
  // S11.4: the harness-owned composed-scope lifecycle installs here; the
  // startup root consumes the application port helpers and imports no
  // harness internals. In the agent process mode the agent composes its own.
  installExecutionLifecyclePort(runtime
    ? { initialize: async () => { await runtime.initializeProkopExecutionScope(); }, dispose: runtime.disposeProkopExecutionScope }
    : { initialize: async () => {}, dispose: async () => {} });
  return agents;
}
