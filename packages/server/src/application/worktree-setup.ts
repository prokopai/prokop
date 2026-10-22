/**
 * Worktree setup from `.prokop/worktree.json`: the instant part (port block,
 * copies, clones, env and template files) right after `git worktree add`,
 * and the background part (the repository's `setup` commands) behind an
 * approval gate, with a log per worktree and one `worktree.updated` per
 * state change.
 *
 * Commands from a repository are code, so a config hash runs only once the
 * user approved it; a changed config asks again. Nothing is ever rerun on
 * its own: a server restart marks a running setup `interrupted`, and Retry
 * is a user action (docs/plans/worktree-setup.md).
 */

import type { WorktreeSetup } from '@prokopai/sdk';
import type {
  ManagedWorktreeRecord,
  WorktreePortProbePort,
  WorktreeSetupCommandPort,
  WorktreeSetupFilesPort,
  WorktreeSetupLogPort,
  WorktreeSetupRecord,
  WorktreeSetupRepositoryPort,
} from '@/application/ports/worktree';
import { allocatePortBlock, PORT_RANGE_END, PORT_RANGE_START } from '@/domains/worktrees/port-blocks';
import {
  parseWorktreeSetupConfig,
  renderEnvFile,
  renderTemplate,
  worktreeKey,
  worktreeSlug,
  type TemplateVariables,
  type WorktreeConfigParsed,
  type WorktreeSetupConfig,
} from '@/domains/worktrees/setup-config';

export type WorktreeSetupPrepared =
  | { ok: true; parsed: WorktreeConfigParsed | null }
  | { ok: false; message: string };

export interface WorktreeSetupApplyInput {
  record: ManagedWorktreeRecord;
  parsed: WorktreeConfigParsed;
  repositoryTopLevel: string;
}

export interface WorktreeSetupRerunInput {
  record: ManagedWorktreeRecord;
  repositoryTopLevel: string;
}

export type WorktreeSetupRerunFailure = 'worktree_config_invalid' | 'no_setup_config' | 'setup_running';

export type WorktreeSetupRerunResult =
  | { ok: true; record: WorktreeSetupRecord }
  | { ok: false; code: WorktreeSetupRerunFailure; message: string };

export interface WorktreeSetupRunner {
  /** Reads and validates the primary checkout's config; null parsed means no config. */
  prepare(repositoryTopLevel: string): Promise<WorktreeSetupPrepared>;
  /** Allocates ports, writes files into a fresh worktree, then starts or gates the commands. */
  apply(input: WorktreeSetupApplyInput): Promise<WorktreeSetupRecord>;
  /** Re-run or retry: repeats the instant steps (keeping the port block) and the commands. */
  rerun(input: WorktreeSetupRerunInput): Promise<WorktreeSetupRerunResult>;
  /** Approves the primary checkout's current config for this repository, then re-runs. */
  approve(input: WorktreeSetupRerunInput): Promise<WorktreeSetupRerunResult>;
  get(worktreeId: string): WorktreeSetupRecord | null;
  /** The wire shape for a record, or the `none` state without one. */
  publicSetup(record: WorktreeSetupRecord | null): WorktreeSetup;
  isRunning(worktreeId: string): boolean;
  /** Resolves once no background run is active for the worktree. */
  settled(worktreeId: string): Promise<void>;
  /** Kills a running setup; the record becomes `interrupted`. */
  cancel(worktreeId: string): Promise<void>;
  log(worktreeId: string): Promise<string>;
  /** Startup: rows left `running` by a previous process become `interrupted`. */
  recoverInterrupted(): number;
  /** Shutdown: kills every running setup and waits for the records to settle. */
  stopAll(): Promise<void>;
}

export interface WorktreeSetupRunnerDeps {
  files: WorktreeSetupFilesPort;
  ports: WorktreePortProbePort;
  repository: WorktreeSetupRepositoryPort;
  commands: WorktreeSetupCommandPort;
  log: WorktreeSetupLogPort;
  /** Called after every stored state change so the owner can broadcast. */
  onChanged?: (worktreeId: string) => void;
  /** Base environment for commands; default: the server's minus its own variables. */
  environment?: () => Record<string, string>;
  commandTimeoutMs?: number;
  now?: () => string;
}

const NO_SETUP: WorktreeSetup = { state: 'none', ports: null, step: null, error: null, warning: null };
const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60_000;
const ERROR_TAIL_LINES = 30;
const ERROR_TAIL_CHARS = 4000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Server-only variables stay out of setup commands: provider keys and the
 * server's own configuration are not the project's concern.
 */
export function setupBaseEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (key.startsWith('PROKOPAI_') || key.startsWith('JEAN2_')) continue;
    env[key] = value;
  }
  return env;
}

function tail(text: string): string {
  const lines = text.trimEnd().split('\n');
  return lines.slice(-ERROR_TAIL_LINES).join('\n').slice(-ERROR_TAIL_CHARS);
}

interface ActiveRun {
  cancelled: boolean;
  current: { kill(): void } | null;
  settled: Promise<void>;
}

export function createWorktreeSetupRunner(deps: WorktreeSetupRunnerDeps): WorktreeSetupRunner {
  const now = deps.now ?? (() => new Date().toISOString());
  const commandTimeoutMs = deps.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const baseEnvironment = deps.environment ?? (() => setupBaseEnvironment());
  const active = new Map<string, ActiveRun>();

  function store(record: WorktreeSetupRecord): WorktreeSetupRecord {
    const stored = deps.repository.upsert({ ...record, updatedAt: now() });
    deps.onChanged?.(record.worktreeId);
    return stored;
  }

  function variablesFor(record: ManagedWorktreeRecord, repositoryTopLevel: string, port: number | null): TemplateVariables {
    return {
      port,
      name: record.name,
      slug: worktreeSlug(record.name),
      key: worktreeKey(record.name, record.id),
      id: record.id,
      path: record.path,
      rootPath: repositoryTopLevel,
    };
  }

  /**
   * Port block, checks, then writes. Every check runs before any write, so
   * a refused entry leaves the worktree exactly as Git created it. Returns
   * the stored record (`failed`, or `ready` as a placeholder the caller
   * turns into the command phase) and the template variables.
   */
  async function instantSteps(
    record: ManagedWorktreeRecord,
    parsed: WorktreeConfigParsed,
    repositoryTopLevel: string,
    existing: WorktreeSetupRecord | null,
  ): Promise<{ record: WorktreeSetupRecord; variables: TemplateVariables }> {
    const { config } = parsed;
    const worktreePath = record.path;
    const notes: string[] = [];
    const base: Omit<WorktreeSetupRecord, 'state' | 'step' | 'error' | 'warning' | 'updatedAt'> = {
      worktreeId: record.id,
      configHash: parsed.hash,
      portBase: null,
      portCount: null,
    };
    const fail = (step: string, error: string): WorktreeSetupRecord => store({
      ...base,
      state: 'failed',
      step,
      error,
      warning: notes.length ? notes.join('; ') : null,
      updatedAt: now(),
    });

    // Ports first, and stored at once so a concurrent create in another
    // repository cannot pick the same block while files are written. A
    // re-run keeps the worktree's block when it is still large enough.
    if (config.ports !== null) {
      if (existing?.portBase !== null && existing?.portBase !== undefined
        && existing.portCount !== null && existing.portCount >= config.ports) {
        base.portBase = existing.portBase;
        base.portCount = existing.portCount;
      } else {
        const held = deps.repository.listPortBlocks().filter((block) => block.base !== existing?.portBase);
        const block = await allocatePortBlock(config.ports, held, deps.ports.isFree);
        if (!block) {
          const variables = variablesFor(record, repositoryTopLevel, null);
          return {
            record: fail('ports', `No free block of ${config.ports} ports between ${PORT_RANGE_START} and ${PORT_RANGE_END}`),
            variables,
          };
        }
        base.portBase = block.base;
        base.portCount = block.count;
      }
      store({ ...base, state: 'running', step: 'files', error: null, warning: null, updatedAt: now() });
    }

    const variables = variablesFor(record, repositoryTopLevel, base.portBase);

    const copies: string[] = [];
    const clones: string[] = [];
    try {
      for (const entry of config.copy) {
        if (await deps.files.sourceExists(repositoryTopLevel, entry)) copies.push(entry);
        else notes.push(`skipped copy ${entry}: not in the primary checkout`);
      }
      for (const entry of config.clone) {
        if (await deps.files.sourceExists(repositoryTopLevel, entry)) clones.push(entry);
        else notes.push(`skipped clone ${entry}: not in the primary checkout`);
      }
      const destinations = [
        ...copies,
        ...clones,
        ...(Object.keys(config.env).length ? [config.envFile] : []),
        ...Object.keys(config.files),
      ];
      const refused: string[] = [];
      for (const entry of destinations) {
        if (!(await deps.files.isContained(worktreePath, entry))) {
          refused.push(`${entry} leaves the worktree`);
        } else if (!(await deps.files.isIgnored(worktreePath, entry))) {
          refused.push(`add ${entry} to .gitignore, otherwise the worktree turns dirty and cannot be removed`);
        }
      }
      if (refused.length) return { record: fail('check', refused.join('; ')), variables };
    } catch (error: unknown) {
      return { record: fail('check', messageOf(error)), variables };
    }

    let step = '';
    try {
      for (const entry of copies) {
        step = `copy ${entry}`;
        await deps.files.copyFile(repositoryTopLevel, worktreePath, entry);
      }
      for (const entry of clones) {
        step = `clone ${entry}`;
        try {
          await deps.files.cloneDirectory(repositoryTopLevel, worktreePath, entry);
        } catch (error: unknown) {
          // Clone or skip, never a full copy; `setup` installs instead.
          notes.push(`skipped clone ${entry}: ${messageOf(error)}`);
        }
      }
      if (Object.keys(config.env).length) {
        step = `write ${config.envFile}`;
        await deps.files.writeFile(worktreePath, config.envFile, renderEnvFile(config.env, variables));
      }
      for (const [entry, template] of Object.entries(config.files)) {
        step = `write ${entry}`;
        await deps.files.writeFile(worktreePath, entry, renderTemplate(template, variables));
      }
    } catch (error: unknown) {
      return { record: fail(step, messageOf(error)), variables };
    }

    return {
      record: {
        ...base,
        state: 'ready',
        step: null,
        error: null,
        warning: notes.length ? notes.join('; ') : null,
        updatedAt: now(),
      },
      variables,
    };
  }

  function commandEnvironment(
    config: WorktreeSetupConfig,
    variables: TemplateVariables,
  ): Record<string, string> {
    // Scrubbed whatever the base is, so an injected environment cannot leak
    // server variables either.
    const env = setupBaseEnvironment(baseEnvironment());
    for (const [key, value] of Object.entries(config.env)) env[key] = renderTemplate(value, variables);
    if (variables.port !== null) env.PROKOP_WORKTREE_PORT = String(variables.port);
    env.PROKOP_WORKTREE_NAME = variables.name;
    env.PROKOP_WORKTREE_KEY = variables.key;
    env.PROKOP_WORKTREE_PATH = variables.path;
    env.PROKOP_ROOT_PATH = variables.rootPath;
    return env;
  }

  /** Runs the commands in order, outside any queue; one state change per step. */
  function startCommands(
    record: ManagedWorktreeRecord,
    base: WorktreeSetupRecord,
    config: WorktreeSetupConfig,
    variables: TemplateVariables,
  ): WorktreeSetupRecord {
    const worktreeId = record.id;
    const total = config.setup.length;
    const stepLabel = (index: number): string => `setup ${index + 1}/${total}: ${config.setup[index]}`;
    let settle: () => void = () => {};
    const run: ActiveRun = {
      cancelled: false,
      current: null,
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    active.set(worktreeId, run);
    const started = store({ ...base, state: 'running', step: stepLabel(0), error: null });

    let chain = Promise.resolve();
    const write = (text: string): void => {
      chain = chain.then(() => deps.log.append(worktreeId, text)).catch(() => undefined);
    };
    const env = commandEnvironment(config, variables);

    void (async () => {
      let outcome: WorktreeSetupRecord = { ...started, state: 'ready', step: null, error: null };
      try {
        await deps.log.remove(worktreeId).catch(() => undefined);
        write(`# setup for ${record.name} (${worktreeId}) at ${now()}\n`);
        for (let index = 0; index < total; index += 1) {
          if (run.cancelled) break;
          const command = config.setup[index] ?? '';
          if (index > 0) store({ ...started, step: stepLabel(index) });
          write(`\n$ ${command}\n`);
          let output = '';
          const running = deps.commands.run({
            cwd: record.path,
            command,
            env,
            timeoutMs: commandTimeoutMs,
            onOutput: (chunk) => {
              output = (output + chunk).slice(-ERROR_TAIL_CHARS * 4);
              write(chunk);
            },
          });
          run.current = running;
          const result = await running.done;
          run.current = null;
          if (run.cancelled) break;
          if (result.timedOut) {
            write(`\n# timed out after ${Math.round(commandTimeoutMs / 60_000)} minutes\n`);
            outcome = {
              ...started,
              state: 'failed',
              step: stepLabel(index),
              error: `timed out after ${Math.round(commandTimeoutMs / 60_000)} minutes\n${tail(output)}`.trim(),
            };
            break;
          }
          if (result.exitCode !== 0) {
            const reason = result.exitCode === null ? `killed by ${result.signal ?? 'signal'}` : `exit code ${result.exitCode}`;
            write(`\n# ${reason}\n`);
            outcome = { ...started, state: 'failed', step: stepLabel(index), error: `${reason}\n${tail(output)}`.trim() };
            break;
          }
        }
        if (run.cancelled) {
          write('\n# cancelled\n');
          outcome = { ...started, state: 'interrupted', step: deps.repository.get(worktreeId)?.step ?? null, error: 'Setup was stopped before it finished' };
        }
      } catch (error: unknown) {
        outcome = { ...started, state: 'failed', error: messageOf(error) };
      } finally {
        await chain;
        active.delete(worktreeId);
        // The worktree may have been purged while the command ran.
        if (deps.repository.get(worktreeId)) store(outcome);
        settle();
      }
    })();

    return started;
  }

  /** After the instant steps: commands start, wait for approval, or there are none. */
  function finish(
    record: ManagedWorktreeRecord,
    parsed: WorktreeConfigParsed,
    instant: { record: WorktreeSetupRecord; variables: TemplateVariables },
  ): WorktreeSetupRecord {
    if (instant.record.state !== 'ready') return instant.record;
    if (parsed.config.setup.length === 0) return store(instant.record);
    if (!deps.repository.isApproved(record.repositoryId, parsed.hash)) {
      return store({ ...instant.record, state: 'needs_approval', step: null });
    }
    return startCommands(record, instant.record, parsed.config, instant.variables);
  }

  async function rerun(
    { record, repositoryTopLevel }: WorktreeSetupRerunInput,
    approveFirst: boolean,
  ): Promise<WorktreeSetupRerunResult> {
    if (active.has(record.id)) {
      return { ok: false, code: 'setup_running', message: 'Setup is already running for this worktree' };
    }
    const prepared = await runner.prepare(repositoryTopLevel);
    if (!prepared.ok) return { ok: false, code: 'worktree_config_invalid', message: prepared.message };
    if (!prepared.parsed) {
      return { ok: false, code: 'no_setup_config', message: 'The repository has no .prokop/worktree.json' };
    }
    if (approveFirst) deps.repository.approve(record.repositoryId, prepared.parsed.hash, now());
    const instant = await instantSteps(record, prepared.parsed, repositoryTopLevel, deps.repository.get(record.id));
    return { ok: true, record: finish(record, prepared.parsed, instant) };
  }

  const runner: WorktreeSetupRunner = {
    async prepare(repositoryTopLevel) {
      let text: string | null;
      try {
        text = await deps.files.readConfig(repositoryTopLevel);
      } catch (error: unknown) {
        return { ok: false, message: `Could not read .prokop/worktree.json: ${messageOf(error)}` };
      }
      if (text === null) return { ok: true, parsed: null };
      const parsed = parseWorktreeSetupConfig(text);
      return parsed.ok ? { ok: true, parsed } : { ok: false, message: parsed.message };
    },

    async apply({ record, parsed, repositoryTopLevel }) {
      const instant = await instantSteps(record, parsed, repositoryTopLevel, null);
      return finish(record, parsed, instant);
    },

    rerun: (input) => rerun(input, false),
    approve: (input) => rerun(input, true),

    get(worktreeId) {
      return deps.repository.get(worktreeId);
    },

    publicSetup(record) {
      if (!record) return NO_SETUP;
      return {
        state: record.state,
        ports: record.portBase !== null && record.portCount !== null
          ? { base: record.portBase, count: record.portCount }
          : null,
        step: record.step,
        error: record.error,
        warning: record.warning,
      };
    },

    isRunning(worktreeId) {
      return active.has(worktreeId);
    },

    settled(worktreeId) {
      return active.get(worktreeId)?.settled ?? Promise.resolve();
    },

    async cancel(worktreeId) {
      const run = active.get(worktreeId);
      if (!run) return;
      run.cancelled = true;
      run.current?.kill();
      await run.settled;
    },

    log(worktreeId) {
      return deps.log.read(worktreeId);
    },

    recoverInterrupted() {
      const stale = deps.repository.listByState('running').filter((record) => !active.has(record.worktreeId));
      for (const record of stale) {
        deps.repository.upsert({
          ...record,
          state: 'interrupted',
          error: 'The server restarted while setup was running',
          updatedAt: now(),
        });
      }
      return stale.length;
    },

    async stopAll() {
      await Promise.all([...active.keys()].map((worktreeId) => runner.cancel(worktreeId)));
    },
  };

  return runner;
}
