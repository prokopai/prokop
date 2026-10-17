import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolDefinition } from '@prokopai/sdk/tool';
import { LoadedTool } from '@prokopai/sdk/tool';

/**
 * The tool registry is the composed scope's resolver: built-in tools, domain
 * tool payloads and policy tools, installed per agent scope. Tools come from
 * the binary and from MCP servers; there is no on-disk tool directory.
 */

export interface ToolRegistryResolver {
  get(name: string): LoadedTool | null;
  list(): LoadedTool[];
}

const scopedResolver = new AsyncLocalStorage<ToolRegistryResolver>();

export function withToolRegistryResolver<T>(resolver: ToolRegistryResolver, callback: () => T): T {
  return scopedResolver.run(resolver, callback);
}

/** True when an ambient scoped tool resolver is installed. The legacy
 * unscoped execution path keeps its unconditional builtin-tool injection;
 * scoped compositions resolve every tool, including retrieve-tool-output,
 * through their resolver instead. */
export function hasScopedToolRegistryResolver(): boolean {
  return scopedResolver.getStore() !== undefined;
}

/** The named tool of the ambient scope, or null outside a composed scope. */
export async function getTool(name: string): Promise<LoadedTool | null> {
  return scopedResolver.getStore()?.get(name) ?? null;
}

export async function listTools(): Promise<ToolDefinition[]> {
  return (scopedResolver.getStore()?.list() ?? []).map((loaded) => loaded.definition);
}
