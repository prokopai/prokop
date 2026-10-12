import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@prokopai/sdk';
import { agentDirectoryPath } from '@/domains/agents/home';
import { effectivePath } from '@/domains/permissions';
import { getDataDir, getUploadDir } from '@/infrastructure/runtime/paths';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { ensureSessionTempDir } from '@/infrastructure/filesystem/session-temp';

/** Allowed roots for a session's permission checks. */
export interface SessionPermissionRoots {
  /** Readable and writable: the selected root plus workspace additional paths. */
  roots: string[];
  /** Readable only: the session agent's own directory, the upload dir and harness skill folders. */
  readRoots: string[];
}

/**
 * Folders the Claude Code and Codex CLIs load skills and plugins from, so an
 * agent can read a skill without an outside-workspace ask. Only these folders:
 * the rest of each home holds credentials, settings and other conversations.
 */
export function harnessSkillRoots(home: string = homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  const claude = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const codex = env.CODEX_HOME || join(home, '.codex');
  return [join(claude, 'skills'), join(claude, 'plugins'), join(codex, 'skills'), join(codex, 'plugins'),
    join(home, '.agents', 'skills')];
}

/**
 * The one definition of "allowed paths" for native harness permission
 * checks, matching the Prokop tool host (harnesses/prokop/host/workspace.ts):
 * additional paths are workspace roots except in managed worktree sessions,
 * and the agent directory (skills, home, memory files), uploads and the
 * harness skill folders are readable without an outside-workspace ask. Paths are symlink-resolved so
 * they compare against the classifiers' effective paths.
 */
export function sessionPermissionRoots(
  session: Pick<Session, 'id' | 'workspaceId' | 'workspaceRootId' | 'agentId'>,
  root: string,
): SessionPermissionRoots {
  const additional = session.workspaceRootId ? [] : getWorkspace(session.workspaceId)?.additionalPaths ?? [];
  const agentDir = session.agentId ? agentDirectoryPath(getDataDir(), session.agentId) : null;
  const existing = (paths: Array<string | null>): string[] =>
    [...new Set(paths.filter((path): path is string => !!path && existsSync(path)).map(effectivePath))];
  return {
    roots: [effectivePath(root), ensureSessionTempDir(session.id), ...existing(additional)],
    readRoots: existing([agentDir, getUploadDir(), ...harnessSkillRoots()]),
  };
}
