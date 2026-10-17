/**
 * Tells a session when a background shell command finishes.
 *
 * The tool returns a long command as "running" and moves on. When that
 * command exits, the host delivers a user message to the session: steered
 * into a running turn, or starting a new one when the session is idle. The
 * message is a normal prompt with a terminal context chip, so clients render
 * it like a pasted terminal excerpt and the model reads the output inline.
 */

import { joinContextEnvelope, type TerminalContextReference } from '@prokopai/sdk';
import { getCommandRegistry, type CommandRecord, type CommandRegistry } from './commands';

export interface ShellCompletionPort {
  /** Delivers one prompt to the session; the host decides steer versus new turn. */
  deliver(sessionId: string, content: string): Promise<void>;
}

/** Output lines carried in the completion message. */
export const COMPLETION_TAIL_BYTES = 16 * 1024;
const LABEL_LENGTH = 60;

let port: ShellCompletionPort | null = null;
let unsubscribe: (() => void) | null = null;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

function label(command: string): string {
  const oneLine = command.replace(/\s+/g, ' ').trim();
  return oneLine.length > LABEL_LENGTH ? `${oneLine.slice(0, LABEL_LENGTH - 1)}…` : oneLine;
}

/** The prompt a finished background command turns into. */
export function completionMessage(record: CommandRecord, registry: CommandRegistry): string {
  const { text, truncated } = registry.tail(record.id, COMPLETION_TAIL_BYTES);
  const duration = formatDuration((record.endedAt ?? Date.now()) - record.startedAt);
  const outcome = record.status === 'killed'
    ? 'was killed'
    : record.error
      ? `could not start (${record.error})`
      : record.exitCode === 0
        ? 'finished successfully'
        : record.exitCode === null
          ? `ended by signal ${record.signal ?? 'unknown'}`
          : `exited with code ${record.exitCode}`;
  const reference: TerminalContextReference = {
    kind: 'terminal',
    id: record.id,
    label: label(record.command),
    cwd: record.cwd,
    text: text.trimEnd() || '(no output)',
  };
  const lines = [
    `Background command ${record.id} ${outcome} after ${duration}: \`${label(record.command)}\` [${reference.label}](#context-${record.id})`,
    truncated
      ? `Showing the last ${COMPLETION_TAIL_BYTES / 1024} KiB of ${record.lines} lines; the full output is in ${record.outputPath}.`
      : `Full output: ${record.outputPath}`,
  ];
  return joinContextEnvelope(lines.join('\n'), [reference]);
}

/**
 * Installs (or clears with null) the host's delivery and listens for exits
 * of commands the tool left running. Short commands finish inside their tool
 * call and are not announced twice.
 */
export function configureShellCompletions(value: ShellCompletionPort | null, registry: CommandRegistry = getCommandRegistry()): void {
  port = value;
  unsubscribe?.();
  unsubscribe = null;
  if (!value) return;
  unsubscribe = registry.onExit((record) => {
    // A killed command is never news: the model's own kill already answered, and a
    // kill from archive, delete, undo or edit must not put a note into a rewritten history.
    if (!record.detached || record.status === 'killed' || !port) return;
    void port.deliver(record.sessionId, completionMessage(record, registry)).catch((error: unknown) => {
      console.error('[shell] completion delivery failed', { sessionId: record.sessionId, id: record.id,
        error: error instanceof Error ? error.message : String(error) });
    });
  });
}

/** Kills everything a session still has running; for session delete and archive. */
export function killShellCommandsForSession(sessionId: string, registry: CommandRegistry = getCommandRegistry()): Promise<void> {
  return registry.killForSession(sessionId);
}
