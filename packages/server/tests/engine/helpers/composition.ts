import { createAgentScope, createProcessScope } from '@prokopai/agent/internal/harnesses/prokop/composition/plugins/compose';
import {
  JEAN2_AGENT_PLUGIN_IDS,
  JEAN2_PROCESS_PLUGIN_IDS,
  prokopAgentPlugins,
  prokopProcessPlugins,
} from '@prokopai/agent/internal/harnesses/prokop/composition/profile';
import type { AgentScopeHandle, RuntimePlugin, ProcessScopeHandle } from '@prokopai/agent/internal/harnesses/prokop/composition/plugins/compose';

// The production Prokop profile, so engine tests compose exactly what a
// real turn composes (a hand-kept copy drifted from production before).
export const CURRENT_PROCESS_PLUGIN_IDS = JEAN2_PROCESS_PLUGIN_IDS;
export const CURRENT_AGENT_PLUGIN_IDS = JEAN2_AGENT_PLUGIN_IDS;

export function currentProcessPlugins(): readonly RuntimePlugin<unknown>[] {
  return prokopProcessPlugins();
}

export function currentAgentPlugins(): readonly RuntimePlugin<unknown>[] {
  return prokopAgentPlugins();
}

export async function createTestProcessScope(): Promise<ProcessScopeHandle> {
  return createProcessScope([...currentProcessPlugins()]);
}

export async function createTestAgentScope(parent: ProcessScopeHandle): Promise<AgentScopeHandle> {
  return createAgentScope(parent, [...currentAgentPlugins()]);
}

export const createCurrentProcessScope = createTestProcessScope;
export const createCurrentAgentScope = createTestAgentScope;
