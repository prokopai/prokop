/**
 * Real file, Git and network access for worktree setup: reading the config
 * from the primary checkout, containment and ignore checks, copying and
 * copy-on-write cloning, and the loopback port probe.
 */

import { execFile, spawn } from 'node:child_process';
import { appendFile, copyFile, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import type {
  WorktreePortProbePort,
  WorktreeSetupCommandPort,
  WorktreeSetupFilesPort,
  WorktreeSetupLogPort,
} from '@/application/ports/worktree';
import { WORKTREE_CONFIG_PATH } from '@/domains/worktrees/setup-config';

const CLONE_TIMEOUT_MS = 5 * 60_000;
const LOG_CAP_BYTES = 1024 * 1024;
const CHECK_IGNORE_TIMEOUT_MS = 30_000;

/**
 * `git check-ignore` refuses the `--literal-pathspecs` the shared Git helper
 * adds, so it runs on its own with the same scrubbed environment.
 */
function checkIgnore(worktreePath: string, relativePath: string): Promise<{ code: number; stderr: string }> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
  return new Promise((resolveRun) => {
    execFile(
      'git',
      ['-C', worktreePath, 'check-ignore', '-q', '--', relativePath],
      { env, timeout: CHECK_IGNORE_TIMEOUT_MS, windowsHide: true },
      (error, _stdout, stderr) => {
        const code = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : error ? 128 : 0;
        resolveRun({ code, stderr: String(stderr ?? '') || (error?.message ?? '') });
      },
    );
  });
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function inside(rootReal: string, candidateReal: string): boolean {
  return candidateReal === rootReal || candidateReal.startsWith(rootReal + sep);
}

/**
 * Real path of the deepest existing ancestor of `target` (or `target`
 * itself). Used to check that a write cannot land outside the root through a
 * symlinked parent that already exists.
 */
async function deepestExistingRealPath(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      return await realpath(current);
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function runCopy(args: string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const proc = spawn('cp', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const stderr: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => proc.kill('SIGKILL'), CLONE_TIMEOUT_MS);
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `cp exited with ${code ?? 'signal'}`));
    });
  });
}

export function createWorktreeSetupFilesPort(): WorktreeSetupFilesPort {
  return {
    async readConfig(repositoryTopLevel) {
      try {
        return await readFile(join(repositoryTopLevel, WORKTREE_CONFIG_PATH), 'utf8');
      } catch (error: unknown) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async sourceExists(root, relativePath) {
      const target = resolve(root, relativePath);
      try {
        await lstat(target);
        const [rootReal, targetReal] = await Promise.all([realpath(root), realpath(target)]);
        return inside(rootReal, targetReal);
      } catch (error: unknown) {
        if (isMissing(error)) return false;
        throw error;
      }
    },

    async isIgnored(worktreePath, relativePath) {
      const result = await checkIgnore(worktreePath, relativePath);
      if (result.code === 0) return true;
      if (result.code === 1) return false;
      throw new Error(result.stderr.trim() || 'git check-ignore failed');
    },

    async isContained(root, relativePath) {
      const target = resolve(root, relativePath);
      const rootReal = await realpath(root);
      try {
        const existing = await lstat(target);
        // Writing through a symlink would land wherever it points.
        if (existing.isSymbolicLink()) return false;
      } catch (error: unknown) {
        if (!isMissing(error)) throw error;
      }
      return inside(rootReal, await deepestExistingRealPath(target));
    },

    async copyFile(sourceRoot, worktreePath, relativePath) {
      const destination = resolve(worktreePath, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(sourceRoot, relativePath), destination);
    },

    async cloneDirectory(sourceRoot, worktreePath, relativePath) {
      const source = resolve(sourceRoot, relativePath);
      const destination = resolve(worktreePath, relativePath);
      // Clone or fail: a full copy of node_modules can take minutes and
      // fill the disk, and `setup` installs anyway. `--reflink=always`
      // because `auto` silently copies when the filesystem cannot clone.
      const args = process.platform === 'darwin'
        ? ['-c', '-R', source, destination]
        : process.platform === 'linux'
          ? ['--reflink=always', '-R', source, destination]
          : null;
      if (!args) throw new Error(`copy-on-write clone is not supported on ${process.platform}`);
      await mkdir(dirname(destination), { recursive: true });
      try {
        await runCopy(args);
      } catch (error: unknown) {
        await rm(destination, { recursive: true, force: true });
        throw error;
      }
    },

    async writeFile(worktreePath, relativePath, content) {
      const destination = resolve(worktreePath, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, 'utf8');
    },
  };
}

function canBind(host: string, port: number): Promise<'free' | 'busy' | 'unavailable'> {
  return new Promise((resolveProbe) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolveProbe(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT' ? 'unavailable' : 'busy');
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolveProbe('free'));
    });
  });
}

function loginShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') return { command: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c'] };
  // A login shell so the user's PATH (bun, nvm, asdf) applies, like a terminal.
  return { command: process.env.SHELL || '/bin/bash', args: ['-lc'] };
}

/**
 * Setup commands run with stdin closed (a prompt fails instead of hanging)
 * in their own process group, so a timeout or a cancel kills everything the
 * command started, the same pattern as the Git helper.
 */
export function createWorktreeSetupCommandPort(): WorktreeSetupCommandPort {
  return {
    run({ cwd, command, env, timeoutMs, onOutput }) {
      const shell = loginShell();
      const proc = spawn(shell.command, [...shell.args, command], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      let timedOut = false;
      let killed = false;
      const kill = (): void => {
        if (killed) return;
        killed = true;
        try {
          if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, 'SIGKILL');
          else proc.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);
      proc.stdout.on('data', (chunk: Buffer) => onOutput(chunk.toString('utf8')));
      proc.stderr.on('data', (chunk: Buffer) => onOutput(chunk.toString('utf8')));
      const done = new Promise<{ exitCode: number | null; signal: string | null; timedOut: boolean }>((resolveDone) => {
        proc.on('error', (error) => {
          clearTimeout(timer);
          onOutput(`${error.message}\n`);
          resolveDone({ exitCode: null, signal: null, timedOut });
        });
        proc.on('close', (exitCode, signal) => {
          clearTimeout(timer);
          resolveDone({ exitCode, signal, timedOut });
        });
      });
      return { done, kill };
    },
  };
}

/** One file per worktree under `<dataDir>/worktree-setup/`, tail-capped at 1 MB. */
export function createWorktreeSetupLogPort(dataDir: () => string): WorktreeSetupLogPort {
  const pathFor = (worktreeId: string): string => join(dataDir(), 'worktree-setup', `${worktreeId}.log`);
  return {
    async append(worktreeId, text) {
      const path = pathFor(worktreeId);
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, text, 'utf8');
      const size = (await stat(path)).size;
      if (size > LOG_CAP_BYTES) {
        const content = await readFile(path);
        await writeFile(path, content.subarray(content.length - LOG_CAP_BYTES));
      }
    },

    async read(worktreeId) {
      try {
        return await readFile(pathFor(worktreeId), 'utf8');
      } catch (error: unknown) {
        if (isMissing(error)) return '';
        throw error;
      }
    },

    async remove(worktreeId) {
      await rm(pathFor(worktreeId), { force: true });
    },
  };
}

/** Binds on IPv4 and, when the host has it, IPv6 loopback. */
export function createWorktreePortProbe(): WorktreePortProbePort {
  return {
    async isFree(port) {
      if ((await canBind('127.0.0.1', port)) === 'busy') return false;
      return (await canBind('::1', port)) !== 'busy';
    },
  };
}
