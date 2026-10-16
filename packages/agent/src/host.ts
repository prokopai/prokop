/**
 * The agent's light host entry. What the host imports statically from agent
 * code, without loading the agent runtime. Each export is a small module with
 * no heavy dependency (no AI SDK, Claude SDK, file-format libraries or Prokop
 * execution); the lean-host gate in the server's boundary tests keeps it so.
 * The full runtime is `@prokopai/agent`, loaded lazily
 * (`bootstrap/agent-runtime.ts`).
 */

// What each harness supports, without building it.
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

// Memory and skill file logic the host runs itself (learning staging).
export { executeMemoryTool } from '#agent/harnesses/shared/memory/memory-tool';
export { executeSkillManageTool } from '#agent/harnesses/shared/skills/skill-manage-tool';
export { createProkopLearningRuntime } from '#agent/harnesses/prokop/learning/runtime';

// Session search port the host serves and the harnesses read.
export { configureSessionSearchHost, getSessionSearchHost, type SessionSearchHost } from '#agent/harnesses/shared/session-search/host';
// The tool workspace a session's tools see (host-resolved roots).
export { createProkopToolWorkspaceHost, type ProkopToolWorkspaceDeps } from '#agent/harnesses/prokop/bindings/tool-workspace';
// Ask timeout and authority rule for session sync.
export { createProkopAskAuthorityPort } from '#agent/harnesses/prokop/bindings/ask-authority';
/** In-process ask fallback when no agent ask port is installed. */
export { getAuthorityForPendingAsk, getSessionIdForPendingAsk, resolveAsk } from '#agent/harnesses/prokop/permission/ask-user-api';
