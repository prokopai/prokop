import { getProkopEnvValue } from '@prokopai/core/infrastructure/runtime/environment';
import { agentDirectoryPath } from '@prokopai/core/domains/agents/home';
import { getDataDir, getUploadDir } from '@prokopai/core/infrastructure/runtime/paths';
import type { RuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import type { WorkspaceCapabilityHost } from '@prokopai/core/infrastructure/filesystem/workspace-policy/contracts';
import { ensureSessionTempDir } from '@prokopai/core/infrastructure/filesystem/session-temp';

type ToolWorkspaceOptions = Parameters<RuntimeHost['workspace']['createToolWorkspaceHost']>[0];

/** Host lookups the tool workspace needs; SQLite in-process, protocol-backed in the agent. */
export interface ProkopToolWorkspaceDeps {
  agentIdOf(sessionId: string): string | null | undefined;
  addRoot(workspaceId: string, path: string): boolean | Promise<boolean>;
  removeRoot(workspaceId: string, path: string): boolean | Promise<boolean>;
}

/**
 * The workspace a Prokop tool sees. Read-only roots: uploads and the session
 * agent's own directory (skills, home, memory files), matching
 * harnesses/shared/permission-roots.ts.
 */
export function createProkopToolWorkspaceHost(
  { workspaceId, workspacePath, additionalPaths, sessionId }: ToolWorkspaceOptions,
  deps: ProkopToolWorkspaceDeps,
): WorkspaceCapabilityHost {
  const agentId = deps.agentIdOf(sessionId);
  return {
    root: workspacePath,
    additionalRoots: additionalPaths,
    allowedRoots: [getUploadDir(), ...(agentId ? [agentDirectoryPath(getDataDir(), agentId)] : [])],
    tempDir: ensureSessionTempDir(sessionId),
    getEnvironmentValue: getProkopEnvValue,
    addAdditionalRoot: workspaceId
      ? (path: string) => deps.addRoot(workspaceId, path)
      : undefined,
    removeAdditionalRoot: workspaceId
      ? (path: string) => deps.removeRoot(workspaceId, path)
      : undefined,
  };
}
