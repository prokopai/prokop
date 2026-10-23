/**
 * The agent's public entry. Host code (bootstrap, adapters, transport)
 * reaches harness and agent code only through this module, loaded lazily
 * (`bootstrap/agent-runtime.ts`); harness internals stay private. Light host
 * needs, and everything exported there, come from `@prokopai/agent/host`.
 */

// Harness registrations and the ports the host installs for them.
export { createHarnessRegistration, createHarnessRegistrations } from '#agent/composition/harness-registrations';
export { directAgentAsks } from '#agent/composition/asks';
export { localHarnessProbes } from '#agent/composition/probes';
export { recoverDelegatedTasks } from '#agent/harnesses/prokop/subagent/task-registry';
export { installRuntimeTools } from '#agent/composition/runtime-tools';

// The Prokop runtime's own bindings and process defaults.
export * from '#agent/harnesses/prokop/bindings/index';
export { builtinTools } from '#agent/harnesses/prokop/tools/index';
export { disposeProkopExecutionScope, initializeProkopExecutionScope } from '#agent/harnesses/prokop/composition/execution-scope';

// Ports the harnesses read, configured by the host.
export {
  configureShellCompletions,
  killShellCommandsForSession,
  type ShellCompletionPort,
} from '#agent/harnesses/prokop/tools/shell/completion';
