import type * as AgentRuntime from '@prokopai/agent';
import type * as AgentTools from '@prokopai/agent/tools';
import type * as InProcessBindings from '@/adapters/prokop/runtime-host/bindings';

/*
 * Lazy edges into the agent code (Phase 2.6). Bun evaluates every static
 * import at startup, so the host reaches the agent runtime only through these
 * loaders, and only when it runs the harnesses itself (in-process and
 * loopback modes). With PROKOPAI_AGENT_PROCESS=1 none of them is called on
 * the startup path and the host never evaluates agent code. The host's
 * light needs come from `@prokopai/agent/host`.
 */

let runtime: typeof AgentRuntime | null = null;
let tools: typeof AgentTools | null = null;
let bindings: typeof InProcessBindings | null = null;

/** The full agent runtime (harness registrations, Prokop runtime, agent-side ports). */
export function agentRuntime(): typeof AgentRuntime {
  return (runtime ??= require('@prokopai/agent') as typeof AgentRuntime);
}

/** The built-in tool catalog, loaded on the first catalog read. */
export function agentBuiltinTools(): typeof AgentTools.builtinTools {
  return (tools ??= require('@prokopai/agent/tools') as typeof AgentTools).builtinTools;
}

/** The in-process runtime host (the Prokop runtime's own bindings plus host services). */
export function inProcessBindings(): typeof InProcessBindings {
  return (bindings ??= require('@/adapters/prokop/runtime-host/bindings') as typeof InProcessBindings);
}
