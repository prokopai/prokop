import type { LoadedTool, ToolDefinition, ToolEnvVarStatus } from '@prokopai/sdk';

/** Catalog entry exposed to the tools route: a built-in shipped in the
 * binary, or a domain tool a workspace capability enables. */
export type ToolCatalogEntry = ToolDefinition & {
  source: 'builtin' | 'domain';
};

export interface ToolCatalogPort {
  listTools(): Promise<ToolCatalogEntry[]>;
  getTool(name: string): Promise<LoadedTool | null>;
}

export interface ToolEnvStatus {
  envVars: ToolEnvVarStatus[];
}

export type ToolEnvListPortResult =
  | { ok: true; status: ToolEnvStatus }
  | { ok: false; message: string };

export type ToolEnvSetPortResult =
  | { ok: true; envVar: ToolEnvVarStatus }
  | { ok: false; kind: 'invalid' | 'failed'; message: string };

export type ToolEnvClearPortResult = ToolEnvSetPortResult;

export interface ToolEnvironmentPort {
  listToolEnvVars(): Promise<ToolEnvListPortResult>;
  setToolEnvVar(key: string, value: string): Promise<ToolEnvSetPortResult>;
  clearToolEnvVar(key: string): Promise<ToolEnvClearPortResult>;
}
