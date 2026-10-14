/**
 * The agent's light host entry (Phase 2.6). What the host needs from agent
 * code in every mode, without loading the agent runtime: in process mode the
 * host imports only this. Each export is a small module with no heavy
 * dependency (no AI SDK, Claude SDK, file-format libraries or Prokop
 * execution); the `2.6 gate` in the server's boundary tests keeps it so.
 * The full runtime is `@prokopai/agent`, loaded only in in-process mode.
 */

// Harness shape the host routes to (no harness is built for it).
export { harnessCapabilities, type OptionalHarnessOperation } from '#agent/composition/capabilities';

// CLI availability and versions: machine facts the host probes itself.
export { claudeCliAvailable, claudeCliVersion } from '#agent/harnesses/claude-cli/version';
export { codexCliAvailable, codexCliVersion } from '#agent/harnesses/codex-cli/version';
export { cliWorkspaceAvailable } from '#agent/harnesses/shared/cli-workspace';

// Runtime events to wire messages (host delivery, compaction recovery broadcasts).
export { audienceOf, mapCapekEventToServerMessage } from '#agent/harnesses/prokop/bindings/events';
// Host recovery of interrupted Prokop compactions.
export {
  reconcileAllSessionsCompaction, reconcileSessionCompaction, type CompactionRecoveryDeps,
} from '#agent/harnesses/prokop/compaction/recovery';

// Memory and skill file logic the host runs itself (`knowledge.apply`, learning staging).
export { executeMemoryTool } from '#agent/harnesses/shared/memory/memory-tool';
export { executeSkillManageTool } from '#agent/harnesses/shared/skills/skill-manage-tool';
export { createProkopLearningRuntime } from '#agent/harnesses/prokop/learning/runtime';

// Session search port the host serves (`search.*`) and the in-process harnesses read.
export { configureSessionSearchHost, getSessionSearchHost, type SessionSearchHost } from '#agent/harnesses/shared/session-search/host';
// The tool workspace a session's tools see (host-resolved roots).
export { createProkopToolWorkspaceHost, type ProkopToolWorkspaceDeps } from '#agent/harnesses/prokop/bindings/tool-workspace';
// Ask timeout and authority rule for session sync.
export { createProkopAskAuthorityPort } from '#agent/harnesses/prokop/bindings/ask-authority';
/** In-process ask fallback when no agent ask port is installed. */
export { getAuthorityForPendingAsk, getSessionIdForPendingAsk, resolveAsk } from '#agent/harnesses/prokop/permission/ask-user-api';
