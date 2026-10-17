/**
 * Shell tool: one process per command, a wait window, then background.
 *
 * A call waits up to `timeout` for its command. A command still running after
 * that keeps running in the registry and the call returns its id; the
 * session hears about the exit through the completion port, and the model
 * can read more output or kill it with the `read` and `kill` actions.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { ShellOutputVisualization } from '@prokopai/sdk';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  classifyShellCommand,
  requiresHumanReview,
  resolveCommandPath,
  stripRedundantCd,
  type ShellRiskContext,
} from '@prokopai/core/domains/permissions';
import { sessionTempEnvironment } from '@prokopai/core/infrastructure/filesystem/session-temp';
import { isToolPathAllowed } from '#agent/harnesses/prokop/tools/file-permission';
import { assertDirectory, getCommandRegistry, type CommandRecord, type CommandRegistry } from './commands';

export interface ShellInput {
  command?: string;
  cwd?: string;
  timeout?: number;
  background?: boolean;
  action?: 'run' | 'read' | 'kill';
  id?: string;
  cursor?: number;
}

export const DEFAULT_WAIT_MS = 60_000;
export const MIN_WAIT_MS = 1_000;
export const MAX_WAIT_MS = 10 * 60_000;
/** A background start still catches an immediate failure, such as a missing binary. */
export const BACKGROUND_WAIT_MS = 250;
export const MAX_OUTPUT_BYTES = 32 * 1024;

const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

function platform(): 'windows' | 'unix' {
  return process.platform === 'win32' ? 'windows' : 'unix';
}

/** The user's shell when it speaks POSIX, else /bin/sh. Non-login, non-interactive. */
export function resolveShellPath(): string {
  const shell = process.env.SHELL;
  if (shell && POSIX_SHELLS.has(basename(shell)) && existsSync(shell)) return shell;
  return '/bin/sh';
}

/** Absolute cmd.exe: a daemon may run with a stripped PATH. */
export function resolveCmdExe(): string {
  if (process.env.ComSpec && existsSync(process.env.ComSpec)) return process.env.ComSpec;
  if (process.env.SystemRoot) {
    const candidate = join(process.env.SystemRoot, 'System32', 'cmd.exe');
    if (existsSync(candidate)) return candidate;
  }
  const fallback = join('C:\\Windows', 'System32', 'cmd.exe');
  return existsSync(fallback) ? fallback : 'cmd.exe';
}

export function shellArgv(command: string): string[] {
  return platform() === 'windows'
    ? [resolveCmdExe(), '/d', '/s', '/c', command]
    : [resolveShellPath(), '-c', command];
}

function platformLabel(): string {
  switch (process.platform) {
    case 'darwin': return 'macOS';
    case 'win32': return 'Windows';
    case 'linux': return 'Linux';
    default: return process.platform;
  }
}

function shellLabel(): string {
  return platform() === 'windows' ? 'cmd.exe' : basename(resolveShellPath());
}

export const definition: ToolDefinition = {
  name: 'shell',
  description: `Run a shell command and return its output.

Commands run on ${platformLabel()} with ${shellLabel()}. Each call is a fresh process: the working directory and environment do not carry over between calls, so set cwd per call instead of using cd. Use the read-file, edit, write-file, grep and glob tools for files. Some commands ask the user for approval first.

Waiting: the call waits up to timeout ms (default 60000) for the command to finish. A command still running after that keeps running: the call returns status "running" with an id and the output so far, and you get a message when it finishes. Do not poll for it; keep working on other things or end your response. For servers and watchers pass background: true to return right away.

Follow-ups on a running command: action "read" with its id returns new output since cursor (pass timeout to wait for more), action "kill" stops it. Interactive prompts are not supported: use non-interactive flags such as --yes.

Output: the last 32 KiB are returned. The full output is in a file whose path is in the result; grep it instead of rerunning the command.`,
  display: { summary: '{command}' },
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to run (action "run").',
      },
      cwd: {
        type: 'string',
        description: 'Working directory. Defaults to the workspace root.',
      },
      timeout: {
        type: 'number',
        description: `How long to wait for completion, in milliseconds. Default ${DEFAULT_WAIT_MS}, max ${MAX_WAIT_MS}. The command keeps running after the wait.`,
      },
      background: {
        type: 'boolean',
        description: 'Return right away and keep the command running. For dev servers, watchers and long builds.',
      },
      action: {
        type: 'string',
        enum: ['run', 'read', 'kill'],
        description: 'Default "run". "read" returns new output of a running or finished command; "kill" stops a running one.',
      },
      id: {
        type: 'string',
        description: 'Command id from an earlier result (actions "read" and "kill").',
      },
      cursor: {
        type: 'number',
        description: 'Byte offset to read from (action "read"). Start at 0, then pass the cursor from the previous read.',
      },
    },
    required: [],
  },
  timeout: null,
};

interface Deps {
  registry: CommandRegistry;
  argv?: (command: string) => string[];
}

function clampWait(timeout: number | undefined, fallback: number): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) return fallback;
  return Math.min(Math.max(timeout, MIN_WAIT_MS), MAX_WAIT_MS);
}

function describeOutput(registry: CommandRegistry, record: CommandRecord): { output: string; truncated: boolean } {
  const { text, truncated } = registry.tail(record.id, MAX_OUTPUT_BYTES);
  return { output: text, truncated };
}

function visualize(command: string, record: CommandRecord, output: string): ShellOutputVisualization {
  return {
    type: 'shell-output',
    command: command.substring(0, 100),
    stdout: output || undefined,
    ...(record.exitCode !== null ? { exitCode: record.exitCode } : {}),
    ...(record.status === 'running' ? { status: 'running' as const } : record.status === 'killed' ? { status: 'killed' as const } : {}),
  };
}

function finishedResult(registry: CommandRegistry, record: CommandRecord, command: string): ToolResult {
  const { output, truncated } = describeOutput(registry, record);
  const durationMs = (record.endedAt ?? Date.now()) - record.startedAt;
  if (record.error) {
    return {
      success: false,
      error: `Command could not start: ${record.error}`,
      result: { status: 'failed', error: record.error, outputPath: record.outputPath },
      visualization: visualize(command, record, output),
    };
  }
  const killed = record.status === 'killed';
  const success = !killed && record.exitCode === 0;
  const exitLabel = record.exitCode !== null ? `code ${record.exitCode}` : `signal ${record.signal ?? 'unknown'}`;
  return {
    success,
    result: {
      status: record.status,
      exitCode: record.exitCode,
      ...(record.signal ? { signal: record.signal } : {}),
      durationMs,
      output,
      outputPath: record.outputPath,
      ...(truncated ? { truncated: true, note: `Showing the last ${MAX_OUTPUT_BYTES / 1024} KiB of ${record.lines} lines; the full output is in ${record.outputPath}.` } : {}),
    },
    visualization: visualize(command, record, output),
    ...(!success && { error: killed ? 'Command was killed' : `Command exited with ${exitLabel}${firstErrorLine(output)}` }),
  };
}

function firstErrorLine(output: string): string {
  const line = output.trim().split('\n').pop()?.trim();
  return line ? `: ${line.slice(0, 200)}` : '';
}

function runningResult(registry: CommandRegistry, record: CommandRecord, command: string): ToolResult {
  const { output } = describeOutput(registry, record);
  return {
    success: true,
    result: {
      status: 'running',
      id: record.id,
      output,
      cursor: record.bytes,
      outputPath: record.outputPath,
      hint: `Still running as ${record.id}. You will get a message when it finishes; do not poll. Read new output with action "read" (cursor ${record.bytes}), or stop it with action "kill".`,
    },
    visualization: visualize(command, record, output),
  };
}

async function run(input: ShellInput, ctx: ToolContext, deps: Deps): Promise<ToolResult> {
  const commandInput = input.command?.trim() ?? '';
  if (!commandInput) {
    return { success: false, error: 'EMPTY_COMMAND: shell tool requires a non-empty command' };
  }

  const resolvedCwd = input.cwd ? ctx.resolvePath(input.cwd) : ctx.workspacePath;
  const riskCtx: ShellRiskContext = ctx as unknown as ShellRiskContext;
  const resolveFromCwd = (path: string): string => resolveCommandPath(path, resolvedCwd, riskCtx);
  const effectiveCommand = stripRedundantCd(commandInput, resolvedCwd, resolveFromCwd);

  // Permissions v2: classify, then ask only when a real concern exists.
  const outsideWorkspaceCwd = !!input.cwd && !isToolPathAllowed(ctx, resolvedCwd, 'write');
  const classification = classifyShellCommand(effectiveCommand,
    [ctx.workspacePath, ctx.fs.tempDir], resolvedCwd, { cwdOutsideRoots: outsideWorkspaceCwd,
      readRoots: ctx.allowedPaths, isWithinRoots: path => ctx.isWithinWorkspace(path) });

  if (!classification) return { success: false, error: 'INVALID_COMMAND: permission classification failed' };
  if (requiresHumanReview(classification.finding)) {
    const approved = await ctx.ask(classification.ask);
    if (!approved) return { success: false, error: 'USER_REJECTION' };
  }
  if (ctx.abortSignal.aborted) return { success: false, error: 'Tool execution interrupted' };

  assertDirectory(resolvedCwd);
  const record = deps.registry.start({
    sessionId: ctx.sessionId,
    command: effectiveCommand,
    argv: (deps.argv ?? shellArgv)(effectiveCommand),
    cwd: resolvedCwd,
    env: { ...process.env as Record<string, string>, ...sessionTempEnvironment(ctx.fs.tempDir) },
    outputDir: join(ctx.fs.tempDir, 'shell'),
  });

  const waitMs = input.background ? BACKGROUND_WAIT_MS : clampWait(input.timeout, DEFAULT_WAIT_MS);
  const settled = await deps.registry.wait(record.id, waitMs, ctx.abortSignal);

  if (ctx.abortSignal.aborted) {
    // The person stopped the turn: a command inside its wait window goes with it.
    if (settled.status === 'running') await deps.registry.kill(record.id);
    return { success: false, error: 'Tool execution interrupted' };
  }
  if (settled.status !== 'running') return finishedResult(deps.registry, settled, effectiveCommand);
  deps.registry.detach(record.id);
  return runningResult(deps.registry, settled, effectiveCommand);
}

async function read(input: ShellInput, ctx: ToolContext, deps: Deps): Promise<ToolResult> {
  if (!input.id) return { success: false, error: 'id is required for action "read"' };
  let record = deps.registry.get(input.id);
  if (!record || record.sessionId !== ctx.sessionId) return { success: false, error: `Unknown command: ${input.id}` };
  if (record.status === 'running' && typeof input.timeout === 'number' && input.timeout > 0) {
    record = await deps.registry.wait(record.id, clampWait(input.timeout, DEFAULT_WAIT_MS), ctx.abortSignal);
  }
  const cursor = typeof input.cursor === 'number' && input.cursor >= 0 ? input.cursor : 0;
  const page = deps.registry.read(record.id, cursor, MAX_OUTPUT_BYTES);
  return {
    success: true,
    result: {
      id: record.id,
      status: record.status,
      ...(record.exitCode !== null ? { exitCode: record.exitCode } : {}),
      output: page.text,
      cursor: page.cursor,
      totalBytes: page.total,
      outputPath: record.outputPath,
      ...(page.cursor < page.total ? { note: 'More output follows; read again from the returned cursor.' } : {}),
    },
    visualization: visualize(record.command, record, page.text),
  };
}

async function kill(input: ShellInput, ctx: ToolContext, deps: Deps): Promise<ToolResult> {
  if (!input.id) return { success: false, error: 'id is required for action "kill"' };
  const record = deps.registry.get(input.id);
  if (!record || record.sessionId !== ctx.sessionId) return { success: false, error: `Unknown command: ${input.id}` };
  if (record.status !== 'running') {
    return { success: true, result: { id: record.id, status: record.status, exitCode: record.exitCode, note: 'The command had already finished.' } };
  }
  const ended = await deps.registry.kill(record.id);
  return {
    success: true,
    result: { id: record.id, status: ended?.status ?? 'killed' },
    visualization: visualize(record.command, ended ?? record, deps.registry.tail(record.id, MAX_OUTPUT_BYTES).text),
  };
}

export function createShellTool(deps: Deps): { definition: ToolDefinition; execute: (input: ShellInput, ctx: ToolContext) => Promise<ToolResult> } {
  return {
    definition,
    async execute(input, ctx) {
      try {
        switch (input.action ?? 'run') {
          case 'run': return await run(input, ctx, deps);
          case 'read': return await read(input, ctx, deps);
          case 'kill': return await kill(input, ctx, deps);
          default: return { success: false, error: `Unknown action: ${String(input.action)}` };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export async function execute(input: ShellInput, ctx: ToolContext): Promise<ToolResult> {
  return createShellTool({ registry: getCommandRegistry() }).execute(input, ctx);
}
