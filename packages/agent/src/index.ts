/**
 * The agent's public entry. Host code (bootstrap, adapters, transport)
 * reaches harness and agent code only through this module, loaded lazily
 * (`bootstrap/agent-runtime.ts`); harness internals stay private. Light host
 * needs come from `@prokopai/agent/host`.
 */

// Harness registrations and the ports the host installs for them.
export { createHarnessRegistration, createHarnessRegistrations } from '#agent/composition/harness-registrations';
export { directAgentAsks } from '#agent/composition/asks';
export { localHarnessProbes } from '#agent/composition/probes';

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
export { configureAgentTerminals, type AgentTerminalPort } from '#agent/harnesses/prokop/tools/terminal/port';
export { configureSessionSearchHost, getSessionSearchHost, type SessionSearchHost } from '#agent/harnesses/shared/session-search/host';

// Memory and skill logic the host runs itself (learning staging).
export { executeMemoryTool } from '#agent/harnesses/shared/memory/memory-tool';
export { executeSkillManageTool } from '#agent/harnesses/shared/skills/skill-manage-tool';
