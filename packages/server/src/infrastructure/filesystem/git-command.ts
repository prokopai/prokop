import { spawn } from 'node:child_process';

/**
 * The one Git runner: scrubbed environment (no inherited GIT_* redirects,
 * no prompts or editors, C locale), literal pathspecs, a timeout and an
 * output cap, and the whole process group killed on stop.
 */

export function fail(message: string): never { throw new Error(`Git operation: ${message}`); }

export const COMMAND_TIMEOUT_MS = 120_000;

/** Why a push failed, so the client can offer a matching recovery. */
export type GitPushFailure = 'pre-push-hook' | 'timeout' | 'rejected' | 'remote-rejected';

/**
 * A Git failure with the end of the command's output attached. The HTTP layer
 * passes `details` to the client, so output must go through `gitOutputTail`.
 */
export class GitOperationError extends Error {
  readonly details: { output?: string; reason?: GitPushFailure };
  constructor(message: string, details: { output?: string; reason?: GitPushFailure } = {}) {
    super(`Git operation: ${message}`);
    this.details = details;
  }
}

/** Git could not run (`start`) or printed more than the cap (`output-limit`). */
export class GitRunError extends Error {
  constructor(message: string, readonly kind: 'start' | 'output-limit') {
    super(message);
  }
}

/**
 * Last lines of Git output for display: credentials in URLs are masked, colour
 * codes and carriage-return progress frames are dropped.
 */
export function gitOutputTail(output: string, maxLines = 60, maxChars = 8000): string {
  const lines = output
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, '$1***@')
    .split('\n')
    .map((line) => line.slice(line.lastIndexOf('\r') + 1).trimEnd());
  while (lines.length && !lines.at(-1)) lines.pop();
  const tail = lines.slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

export async function git(root: string, args: string[], options: {
  index?: string; input?: string | Buffer; allowFailure?: boolean; timeoutMs?: number;
  /** Combined stdout and stderr bytes before Git is stopped (default 2 MB). */
  maxOutputBytes?: number;
} = {}): Promise<{ stdout: string; stdoutBytes: Buffer; stderr: string; output: string; code: number }> {
  const env = { ...process.env };
  // A host's Git invocation must not redirect this operation to another repository/index.
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_PAGER: 'cat', LC_ALL: 'C', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' });
  if (options.index) env.GIT_INDEX_FILE = options.index;
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
  const { stdoutBytes, stderr, output, code } = await new Promise<{ stdoutBytes: Buffer; stderr: string; output: string; code: number }>((resolveResult, reject) => {
    const proc = spawn('git', ['--literal-pathspecs', '-C', root, ...args], {
      env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    // Both streams in arrival order: hook output interleaves stdout and stderr.
    const all: Buffer[] = [];
    let bytes = 0;
    let failure: string | undefined;
    const stop = (message: string) => {
      failure = message;
      // Hooks and credential helpers may hold pipes open. Kill the process group
      // on POSIX and close our pipes so completion never waits on inherited handles.
      try {
        if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, 'SIGKILL');
        else proc.kill('SIGKILL');
      } catch { proc.kill('SIGKILL'); }
      proc.stdout.destroy();
      proc.stderr.destroy();
      proc.stdin.destroy();
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) stop('output limit exceeded. Refresh repository state before retrying.');
      else { chunks.push(chunk); all.push(chunk); }
    };
    proc.stdout.on('data', collect(out));
    proc.stderr.on('data', collect(err));
    proc.stdin.on('error', () => {}); // Git may reject input before consuming it.
    proc.on('error', () => { clearTimeout(timer); reject(new GitRunError('Git operation: could not start Git on the server.', 'start')); });
    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      if (failure === 'timeout') reject(new GitOperationError('command timed out. Refresh repository state before retrying.', { reason: 'timeout', output: gitOutputTail(Buffer.concat(all).toString()) }));
      else if (failure) reject(new GitRunError(`Git operation: ${failure}`, 'output-limit'));
      else resolveResult({ stdoutBytes: Buffer.concat(out), stderr: Buffer.concat(err).toString(), output: Buffer.concat(all).toString(), code: exitCode ?? 1 });
    });
    proc.stdin.end(options.input);
  });
  const stdout = stdoutBytes.toString();
  if (code !== 0 && !options.allowFailure) {
    // Never expose remote URLs, credential helper output, or arbitrary hook output.
    if (stderr.includes('Commit refused: a hook included files outside the selection.')) fail('a Git hook staged unchecked files. Adjust the hook or selection before committing.');
    if (/identity unknown|unable to auto-detect email/i.test(stderr)) fail('configure Git user.name and user.email on the server.');
    if (/signing failed|failed to sign/i.test(stderr)) fail('commit signing failed. Check the server Git signing configuration.');
    if (/non-fast-forward|stale info|fetch first|rejected/i.test(stderr + stdout)) fail('push rejected. The remote changed or is ahead; review it before retrying.');
    fail(`${args[0]} failed. Check Git hooks, credentials, permissions, and repository state on the server.`);
  }
  return { stdout, stdoutBytes, stderr, output, code };
}
