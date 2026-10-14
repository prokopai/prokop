import { formatWithOptions } from 'node:util';
import {
  createAgentEndpoint, createStreamChannel, PROTOCOL_VERSION, RpcErrorCode, RpcRequestError,
  type AgentEndpoint, type AgentHandlers, type MessageChannel,
} from '@prokopai/agent-protocol';
import type { SessionHarness } from '@prokopai/sdk';
import { createAgentsApplication } from '@prokopai/core/application/agents';
import type { AgentWorkspacePort } from '@prokopai/core/application/ports/agents';
import { installBuiltinToolsPort } from '@prokopai/core/application/ports/builtin-tools';
import { getPreconfig, listPreconfigs } from '@prokopai/core/infrastructure/config/preconfig';
import {
  configureProkopAgentSource,
  configureProkopInstructionSource,
  configureProkopPreconfigSource,
  configureProkopRuntimeConfiguration,
  configureProkopWorkspacePolicy,
  configureProkopRuntimeDefaults,
  prokopAgentBindings,
} from '#agent/harnesses/prokop/bindings/index';
import { disposeProkopExecutionScope, initializeProkopExecutionScope } from '#agent/harnesses/prokop/composition/execution-scope';
import { warmInstalledToolsCache } from '#agent/harnesses/prokop/bindings/tool-resolver';
import { builtinTools } from '#agent/harnesses/prokop/tools/index';
import { createAgentDirectoryPort } from '@prokopai/core/infrastructure/agents/agent-directory-filesystem';
import { getDataDir } from '@prokopai/core/infrastructure/runtime/paths';
import { configureWorkspaceKnowledgeRoot } from '@prokopai/core/infrastructure/runtime/workspace-dirs';
import { activateSandbox } from '@prokopai/core/infrastructure/sandbox';
import { installSandboxController } from '@prokopai/core/infrastructure/sandbox/controller';
import { ForwardingSandboxController } from '#agent/protocol/sandbox';
import { composeAgentSide } from './agent-side';
import { createHarnessRegistrations } from './harness-registrations';

const hostOnly = (operation: string) => (): never => {
  throw new Error(`${operation} runs in the host, not in the agent process`);
};

/** Agent homes are host workspaces; the agent process reads agents and preconfigs only. */
const hostOnlyWorkspaces: AgentWorkspacePort = {
  create: hostOnly('Agent workspace creation'),
  get: hostOnly('Agent workspace lookup'),
  applySettings: hostOnly('Agent workspace settings'),
  delete: hostOnly('Agent workspace deletion'),
};

export interface AgentProcessOptions {
  version: string;
}

/**
 * The agent process (host/agent split, Phase 2): the Prokop runtime and the
 * Claude Code and Codex drivers, reaching the host only through `channel`.
 * It never opens the host database. It reads configuration files from the
 * data directory (models, preconfigs, agent directories) like the host does.
 */
export function startAgentProcess(channel: MessageChannel, options: AgentProcessOptions): AgentEndpoint {
  // The host database refuses this process (infrastructure/sqlite/database.ts).
  process.env.PROKOPAI_PROCESS_ROLE = 'agent';
  const agents = createAgentsApplication({
    dataDir: () => getDataDir(),
    directory: createAgentDirectoryPort(),
    workspaces: hostOnlyWorkspaces,
    preconfigs: { get: getPreconfig, list: listPreconfigs },
  });
  installBuiltinToolsPort({ tools: () => builtinTools });
  configureProkopRuntimeConfiguration();
  configureProkopWorkspacePolicy();
  configureProkopPreconfigSource(agents);
  configureProkopAgentSource(agents);
  configureProkopInstructionSource();
  void warmInstalledToolsCache();
  configureProkopRuntimeDefaults();

  const settings = { sandboxActive: false, permissionTimeoutMs: 30 * 60 * 1000 };
  const handlers: AgentHandlers = {};
  const agent = createAgentEndpoint({
    channel,
    handlers,
    onProtocolError: error => console.warn('[agent] protocol error:', error.message),
  });
  // Sandboxed model calls are answered by the host's controller (installed before the scope captures it).
  installSandboxController(new ForwardingSandboxController(agent));
  const side = composeAgentSide(agent, handlers, prokopAgentBindings, {
    isSandboxActive: () => settings.sandboxActive,
    getPermissionTimeoutMs: () => settings.permissionTimeoutMs,
  });
  const registrations = createHarnessRegistrations({
    agents,
    titles: { 'codex-cli': hostOnly('Codex title regeneration'), 'claude-cli': hostOnly('Claude title regeneration') },
  });
  side.registerExecutors(registrations);
  // CLI memory and skill tools resolve worktree knowledge from the roots the host resolved.
  configureWorkspaceKnowledgeRoot(side.knowledgeRootOf);

  handlers.initialize = async (params) => {
    if (params.protocolVersion !== PROTOCOL_VERSION) {
      throw new RpcRequestError(RpcErrorCode.InvalidParams,
        `Protocol version ${params.protocolVersion} is not supported (agent speaks ${PROTOCOL_VERSION})`);
    }
    settings.sandboxActive = params.settings.sandboxActive;
    settings.permissionTimeoutMs = params.settings.permissionTimeoutMs;
    if (settings.sandboxActive) activateSandbox();
    await initializeProkopExecutionScope();
    return {
      protocolVersion: PROTOCOL_VERSION,
      agent: { version: options.version },
      harnesses: Object.keys(registrations) as SessionHarness[],
    };
  };
  handlers.shutdown = async () => {
    await disposeProkopExecutionScope();
    return {};
  };
  return agent;
}

/**
 * The agent process over its own stdio: one JSON message per line on
 * stdin/stdout. stdout carries protocol lines only, so every console method
 * writes to stderr. Exits when the host closes stdin.
 */
export function runAgentProcessOverStdio(options: AgentProcessOptions): void {
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${formatWithOptions({ colors: false }, ...args)}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.warn = toStderr;
  const stdout = Bun.stdout.writer();
  const channel = createStreamChannel({
    readable: Bun.stdin.stream(),
    writer: { write: text => stdout.write(text), flush: () => stdout.flush() },
    onInvalidLine: line => toStderr('[agent] dropped a non-JSON line from the host:', line.slice(0, 200)),
  });
  const agent = startAgentProcess(channel, options);
  void agent.closed.then((reason) => {
    toStderr('[agent] host connection closed:', reason.message);
    process.exit(0);
  });
}
