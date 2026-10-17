/**
 * Shell command registry: one detached process per command, combined output
 * streamed to a file in the session's temp directory, bounded retention.
 *
 * Nothing is shared between commands, so parallel tool calls and long-running
 * servers never block each other. A command outlives the tool call that
 * started it: the tool waits for a window, then leaves the process here and
 * later reads its output, kills it, or hears about its exit through
 * `onExit`.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export type CommandStatus = 'running' | 'completed' | 'killed';

export interface CommandRecord {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  outputPath: string;
  status: CommandStatus;
  /** Null until the process ends, and when it ended by signal or failed to start. */
  exitCode: number | null;
  signal: string | null;
  /** Set when the process could not be started. */
  error?: string;
  startedAt: number;
  endedAt: number | null;
  /** Bytes of combined output written so far. */
  bytes: number;
  lines: number;
  /** The tool returned this command as still running, so its exit is news. */
  detached: boolean;
}

export interface StartCommandInput {
  sessionId: string;
  command: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  /** Output files go here; created when missing. */
  outputDir: string;
}

export interface OutputPage {
  text: string;
  /** Byte offset to pass to the next read. */
  cursor: number;
  /** Total bytes written so far. */
  total: number;
}

export interface SpawnedProcess {
  pid: number | undefined;
  onOutput(listener: (chunk: Uint8Array) => void): void;
  /** Process ended (`exit`) or never started (`error`). */
  onExit(listener: (exit: { code: number | null; signal: string | null; error?: string }) => void): void;
  /** Every output pipe closed; may lag `exit` while a grandchild holds the pipe. */
  onClose(listener: () => void): void;
  /** Keep draining the pipes but stop delivering output. */
  discardOutput(): void;
  /** Signals the whole process group. */
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export type Spawner = (argv: string[], options: { cwd: string; env: Record<string, string> }) => SpawnedProcess;

export interface CommandRegistryOptions {
  spawn?: Spawner;
  /** Exited commands kept per session, oldest dropped first. */
  exitedLimit?: number;
  /** How long output may trail `exit` before the pipes are discarded. */
  closeGraceMs?: number;
  /** SIGKILL follows SIGTERM after this long. */
  killGraceMs?: number;
}

export interface CommandRegistry {
  start(input: StartCommandInput): CommandRecord;
  get(id: string): CommandRecord | null;
  list(sessionId: string): CommandRecord[];
  /** Resolves when the command ends, the window elapses, or the signal aborts. */
  wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandRecord>;
  /** Marks the command as left running by a tool call. */
  detach(id: string): void;
  read(id: string, cursor: number, maxBytes: number): OutputPage;
  /** The last `maxBytes` of output, cut to a line start when truncated. */
  tail(id: string, maxBytes: number): { text: string; truncated: boolean };
  /** Resolves once the process is gone. */
  kill(id: string): Promise<CommandRecord | null>;
  killForSession(sessionId: string): Promise<void>;
  onExit(listener: (record: CommandRecord) => void): () => void;
  /** Synchronous SIGTERM to everything still running; for process exit. */
  shutdown(): void;
}

const DEFAULT_EXITED_LIMIT = 25;
const DEFAULT_CLOSE_GRACE_MS = 1000;
const DEFAULT_KILL_GRACE_MS = 3000;

interface Entry {
  record: CommandRecord;
  process: SpawnedProcess;
  fd: number | null;
  waiters: Set<() => void>;
  killTimer: ReturnType<typeof setTimeout> | null;
  exited: boolean;
}

/** Detached child in its own process group; the group is what gets killed. */
export const nodeSpawner: Spawner = (argv, { cwd, env }) => {
  const child = nodeSpawn(argv[0]!, argv.slice(1), {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  const outputListeners: Array<(chunk: Uint8Array) => void> = [];
  const deliver = (chunk: Buffer): void => {
    for (const listener of outputListeners) listener(chunk);
  };
  child.stdout?.on('data', deliver);
  child.stderr?.on('data', deliver);
  return {
    pid: child.pid,
    onOutput: (listener) => { outputListeners.push(listener); },
    onExit: (listener) => {
      let reported = false;
      const report = (exit: { code: number | null; signal: string | null; error?: string }): void => {
        if (reported) return;
        reported = true;
        listener(exit);
      };
      child.on('exit', (code, signal) => report({ code, signal }));
      child.on('error', (error) => report({ code: null, signal: null, error: error.message }));
    },
    onClose: (listener) => { child.on('close', () => listener()); },
    discardOutput: () => {
      // Keep the pipes flowing so a grandchild writing to them never blocks.
      outputListeners.length = 0;
    },
    kill: (signal) => {
      if (process.platform === 'win32') {
        if (child.pid !== undefined) {
          nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
            .on('error', () => {});
        }
        try { child.kill(); } catch { /* already gone */ }
        return;
      }
      try {
        if (child.pid === undefined) throw new Error('no pid');
        process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    },
  };
};

export function createCommandRegistry(options: CommandRegistryOptions = {}): CommandRegistry {
  const spawn = options.spawn ?? nodeSpawner;
  const exitedLimit = options.exitedLimit ?? DEFAULT_EXITED_LIMIT;
  const closeGraceMs = options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const entries = new Map<string, Entry>();
  const exitOrder = new Map<string, string[]>();
  const exitListeners = new Set<(record: CommandRecord) => void>();
  const killRequested = new Set<string>();

  function require(id: string): Entry {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Unknown command: ${id}`);
    return entry;
  }

  function remove(id: string): void {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    try { unlinkSync(entry.record.outputPath); } catch { /* already gone */ }
  }

  function prune(sessionId: string): void {
    const order = exitOrder.get(sessionId) ?? [];
    while (order.length > exitedLimit) remove(order.shift()!);
  }

  function finish(entry: Entry, exit: { code: number | null; signal: string | null; error?: string }): void {
    const { record } = entry;
    if (record.status !== 'running') return;
    if (entry.killTimer) {
      clearTimeout(entry.killTimer);
      entry.killTimer = null;
    }
    if (entry.fd !== null) {
      try { closeSync(entry.fd); } catch { /* best effort */ }
      entry.fd = null;
    }
    entry.process.discardOutput();
    record.status = killRequested.has(record.id) ? 'killed' : 'completed';
    killRequested.delete(record.id);
    record.exitCode = exit.code;
    record.signal = exit.signal;
    if (exit.error) record.error = exit.error;
    record.endedAt = Date.now();
    const order = exitOrder.get(record.sessionId) ?? [];
    order.push(record.id);
    exitOrder.set(record.sessionId, order);
    for (const waiter of entry.waiters) waiter();
    entry.waiters.clear();
    for (const listener of exitListeners) {
      try { listener(record); } catch { /* a listener must not break the registry */ }
    }
    prune(record.sessionId);
  }

  function start(input: StartCommandInput): CommandRecord {
    mkdirSync(input.outputDir, { recursive: true });
    const id = `sh-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const outputPath = join(input.outputDir, `${id}.out`);
    const record: CommandRecord = {
      id,
      sessionId: input.sessionId,
      command: input.command,
      cwd: input.cwd,
      outputPath,
      status: 'running',
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      endedAt: null,
      bytes: 0,
      lines: 0,
      detached: false,
    };
    const fd = openSync(outputPath, 'w');
    const child = spawn(input.argv, { cwd: input.cwd, env: input.env });
    const entry: Entry = { record, process: child, fd, waiters: new Set(), killTimer: null, exited: false };
    entries.set(id, entry);

    child.onOutput((chunk) => {
      if (entry.fd === null) return;
      try { writeSync(entry.fd, chunk); } catch { return; }
      record.bytes += chunk.length;
      for (let index = chunk.indexOf(10); index !== -1; index = chunk.indexOf(10, index + 1)) record.lines++;
    });
    let closed = false;
    child.onClose(() => { closed = true; });
    child.onExit((exit) => {
      entry.exited = true;
      if (closed || exit.error) {
        finish(entry, exit);
        return;
      }
      // A grandchild may still hold the pipes: take trailing output for a
      // bounded time, then let go so the call cannot hang on it.
      const grace = setTimeout(() => finish(entry, exit), closeGraceMs);
      child.onClose(() => {
        clearTimeout(grace);
        finish(entry, exit);
      });
    });
    return record;
  }

  function wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandRecord> {
    const entry = require(id);
    if (entry.record.status !== 'running' || signal?.aborted) return Promise.resolve(entry.record);
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = (): void => {
        if (timer) clearTimeout(timer);
        entry.waiters.delete(done);
        signal?.removeEventListener('abort', done);
        resolve(entry.record);
      };
      timer = setTimeout(done, Math.max(0, timeoutMs));
      entry.waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  function readBytes(entry: Entry, position: number, length: number): Buffer {
    if (length <= 0) return Buffer.alloc(0);
    const buffer = Buffer.alloc(length);
    let fd: number;
    try { fd = openSync(entry.record.outputPath, 'r'); } catch { return Buffer.alloc(0); }
    try {
      const bytesRead = readSync(fd, buffer, 0, length, position);
      return buffer.subarray(0, bytesRead);
    } finally {
      closeSync(fd);
    }
  }

  function read(id: string, cursor: number, maxBytes: number): OutputPage {
    const entry = require(id);
    const total = entry.record.bytes;
    const start = Math.min(Math.max(0, cursor), total);
    const page = readBytes(entry, start, Math.min(maxBytes, total - start));
    return { text: page.toString('utf8'), cursor: start + page.length, total };
  }

  function tail(id: string, maxBytes: number): { text: string; truncated: boolean } {
    const entry = require(id);
    const total = entry.record.bytes;
    if (total <= maxBytes) return { text: readBytes(entry, 0, total).toString('utf8'), truncated: false };
    const page = readBytes(entry, total - maxBytes, maxBytes);
    const lineStart = page.indexOf(10);
    return { text: page.subarray(lineStart === -1 ? 0 : lineStart + 1).toString('utf8'), truncated: true };
  }

  async function kill(id: string): Promise<CommandRecord | null> {
    const entry = entries.get(id);
    if (!entry) return null;
    if (entry.record.status !== 'running') return entry.record;
    killRequested.add(id);
    entry.process.kill('SIGTERM');
    entry.killTimer = setTimeout(() => {
      entry.killTimer = null;
      if (entry.record.status === 'running') entry.process.kill('SIGKILL');
    }, killGraceMs);
    await wait(id, killGraceMs + closeGraceMs + 1000);
    return entry.record;
  }

  return {
    start,
    get: (id) => entries.get(id)?.record ?? null,
    list: (sessionId) => [...entries.values()].map((entry) => entry.record).filter((record) => record.sessionId === sessionId),
    wait,
    detach: (id) => { require(id).record.detached = true; },
    read,
    tail,
    kill,
    async killForSession(sessionId) {
      await Promise.all([...entries.values()]
        .filter((entry) => entry.record.sessionId === sessionId && entry.record.status === 'running')
        .map((entry) => kill(entry.record.id)));
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => { exitListeners.delete(listener); };
    },
    shutdown() {
      for (const entry of entries.values()) {
        if (entry.record.status === 'running') entry.process.kill('SIGTERM');
      }
    },
  };
}

let defaultRegistry: CommandRegistry | null = null;

/** The process-wide registry; its commands die with the server. */
export function getCommandRegistry(): CommandRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createCommandRegistry();
    process.once('exit', () => defaultRegistry?.shutdown());
  }
  return defaultRegistry;
}

/** Fails early with a clear message instead of a spawn ENOENT. */
export function assertDirectory(path: string): void {
  let stat;
  try { stat = statSync(path); } catch { throw new Error(`Working directory does not exist: ${path}`); }
  if (!stat.isDirectory()) throw new Error(`Working directory is not a directory: ${path}`);
}
