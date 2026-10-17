import { existsSync, lstatSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@prokopai/sdk';
import { agentDirectoryPath } from '@prokopai/core/domains/agents/home';
import { effectivePath } from '@prokopai/core/domains/permissions';
import { getDataDir, getUploadDir } from '@prokopai/core/infrastructure/runtime/paths';
import { getWorkspace } from '@prokopai/core/infrastructure/storage/runtime';
import { ensureSessionTempDir } from '@prokopai/core/infrastructure/filesystem/session-temp';

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
 * Claude Code keeps the output of its background commands in
 * `/tmp/claude-<uid>/<project>/<session>/tasks/*.output` and tells the model
 * to read them from there. Readable, so following that instruction is not an
 * outside-workspace ask. `/tmp` is shared, so the folder only counts when it
 * is a real directory owned by this user that nobody else can write: a
 * planted symlink there must not become a read root.
 */
export function claudeTaskOutputRoot(
  uid: number | undefined = process.getuid?.(),
  platform: NodeJS.Platform = process.platform,
  stat: (path: string) => Stats = (path) => lstatSync(path),
): string | null {
  if (platform === 'win32' || uid === undefined) return null;
  const directory = join('/tmp', `claude-${uid}`);
  try {
    const info = stat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o022) !== 0) return null;
  } catch {
    return null;
  }
  return directory;
}

/**
 * The one definition of "allowed paths" for native harness permission
 * checks, matching the Prokop tool host (harnesses/prokop/host/workspace.ts):
 * additional paths are workspace roots except in managed worktree sessions,
 * and the agent directory (skills, home, memory files), uploads, the harness
 * skill folders and Claude Code's task output folder are readable without an
 * outside-workspace ask. Paths are symlink-resolved so they compare against
 * the classifiers' effective paths.
 */
export async function sessionPermissionRoots(
  session: Pick<Session, 'id' | 'workspaceId' | 'workspaceRootId' | 'agentId'>,
  root: string,
): Promise<SessionPermissionRoots> {
  const additional = session.workspaceRootId ? [] : (await getWorkspace(session.workspaceId))?.additionalPaths ?? [];
  const agentDir = session.agentId ? agentDirectoryPath(getDataDir(), session.agentId) : null;
  const existing = (paths: Array<string | null>): string[] =>
    [...new Set(paths.filter((path): path is string => !!path && existsSync(path)).map(effectivePath))];
  return {
    roots: [effectivePath(root), ensureSessionTempDir(session.id), ...existing(additional)],
    readRoots: existing([agentDir, getUploadDir(), ...harnessSkillRoots(), claudeTaskOutputRoot()]),
  };
}
