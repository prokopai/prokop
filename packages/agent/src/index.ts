/**
 * The agent's public entry (host/agent split, Phase 2.5). Host code (bootstrap,
 * adapters, transport, the host half of agent-bridge) reaches harness and agent
 * code only through this module; harness internals stay private. In-process
 * mode uses it to run the harnesses in the server; the agent process
 * (`packages/agent`) uses the same composition behind the protocol.
 */

// Harness registrations and the agent process.
export { createHarnessRegistration, createHarnessRegistrations } from '#agent/composition/harness-registrations';
export { composeAgentSide, type AgentRegistrations, type AgentSideSettings } from '#agent/composition/agent-side';
export { runAgentProcessOverStdio, startAgentProcess, type AgentProcessOptions } from '#agent/composition/agent-process';
export { askHandlers, directAgentAsks } from '#agent/composition/asks';
export { localHarnessProbes, probeHandlers } from '#agent/composition/probes';

// Agent-side protocol ports and the types the host half shares with them.
export { createProtocolStorageBundle } from '#agent/protocol/storage';
export { createTurnHandlers, type AgentExecutor, type AgentHeadlessRun } from '#agent/protocol/turns';
export { createProtocolRuntimeHost } from '#agent/protocol/runtime-host';
export {
  createProtocolKnowledgeWrite, createProtocolMcpTools, createProtocolSessionSearchHost, createProtocolTerminals,
  createProtocolToolDiscovery, type SessionSearchService, type TerminalAccess,
} from '#agent/protocol/tools';
export { createProtocolHarnessAsks } from '#agent/protocol/harness-asks';
export { ForwardingSandboxController } from '#agent/protocol/sandbox';

// CLI availability and versions (host probes: machine facts, no agent needed).
export { claudeCliAvailable, claudeCliVersion } from '#agent/harnesses/claude-cli/index';
export { codexCliAvailable, codexCliVersion } from '#agent/harnesses/codex-cli/index';
export { cliWorkspaceAvailable } from '#agent/harnesses/shared/cli-workspace';

// The Prokop runtime's own bindings and process defaults.
export * from '#agent/harnesses/prokop/bindings/index';
export { createProkopToolWorkspaceHost, type ProkopToolWorkspaceDeps } from '#agent/harnesses/prokop/bindings/tool-workspace';
export { audienceOf } from '#agent/harnesses/prokop/bindings/events';
export { warmInstalledToolsCache } from '#agent/harnesses/prokop/bindings/tool-resolver';
export { builtinTools } from '#agent/harnesses/prokop/tools/index';
export { disposeProkopExecutionScope, initializeProkopExecutionScope } from '#agent/harnesses/prokop/composition/execution-scope';
export {
  reconcileAllSessionsCompaction, reconcileSessionCompaction, type CompactionRecoveryDeps,
} from '#agent/harnesses/prokop/compaction/recovery';
export { createProkopLearningRuntime } from '#agent/harnesses/prokop/learning/index';
/** In-process ask fallback when no agent ask port is installed. */
export { getAuthorityForPendingAsk, getSessionIdForPendingAsk, resolveAsk } from '#agent/harnesses/prokop/permission/ask-user-api';

// Ports the harnesses read, configured by whoever runs them.
export { configureAgentTerminals } from '#agent/harnesses/prokop/tools/terminal/port';
export { configureKnowledgeWrites } from '#agent/harnesses/shared/knowledge-writes';
export { configureSessionSearchHost, getSessionSearchHost, type SessionSearchHost } from '#agent/harnesses/shared/session-search/host';

// Memory and skill logic the host runs itself (`knowledge.apply`, learning staging).
export { executeMemoryTool } from '#agent/harnesses/shared/memory/memory-tool';
export { executeSkillManageTool } from '#agent/harnesses/shared/skills/skill-manage-tool';
