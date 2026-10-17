import { createAgentScope, createProcessScope } from '@prokopai/agent/internal/harnesses/prokop/composition/plugins/compose';
import { prokopAgentPlugins, prokopProcessPlugins } from '@prokopai/agent/internal/harnesses/prokop/composition/profile';
import type { AgentScopeHandle, RuntimePlugin, ProcessScopeHandle } from '@prokopai/agent/internal/harnesses/prokop/composition/plugins/compose';

// The production Prokop profile, so engine tests compose exactly what a
// real turn composes (a hand-kept copy drifted from production before).
export function currentAgentPlugins(): readonly RuntimePlugin<unknown>[] {
  return prokopAgentPlugins();
}

export async function createCurrentProcessScope(): Promise<ProcessScopeHandle> {
  return createProcessScope([...prokopProcessPlugins()]);
}

export async function createCurrentAgentScope(parent: ProcessScopeHandle): Promise<AgentScopeHandle> {
  return createAgentScope(parent, [...currentAgentPlugins()]);
}
