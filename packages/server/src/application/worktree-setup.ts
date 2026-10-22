/**
 * Instant worktree setup: the synchronous part of making a new managed
 * worktree usable from `.prokop/worktree.json`. Reads and validates the
 * config before the worktree exists, then allocates the port block and
 * copies, clones and writes files right after `git worktree add`.
 *
 * Nothing here runs a repository command; that is the background setup
 * (docs/plans/worktree-setup.md, phase 2).
 */

import type { WorktreeSetup } from '@prokopai/sdk';
import type {
  ManagedWorktreeRecord,
  WorktreePortProbePort,
  WorktreeSetupFilesPort,
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
} from '@/domains/worktrees/setup-config';

export type WorktreeSetupPrepared =
  | { ok: true; parsed: WorktreeConfigParsed | null }
  | { ok: false; message: string };

export interface WorktreeSetupApplyInput {
  record: ManagedWorktreeRecord;
  parsed: WorktreeConfigParsed;
  repositoryTopLevel: string;
}

export interface WorktreeSetupRunner {
  /** Reads and validates the primary checkout's config; null parsed means no config. */
  prepare(repositoryTopLevel: string): Promise<WorktreeSetupPrepared>;
  /** Allocates ports and writes files into a freshly created worktree. */
  apply(input: WorktreeSetupApplyInput): Promise<WorktreeSetupRecord>;
  get(worktreeId: string): WorktreeSetupRecord | null;
  /** The wire shape for a record, or the `none` state without one. */
  publicSetup(record: WorktreeSetupRecord | null): WorktreeSetup;
}

export interface WorktreeSetupRunnerDeps {
  files: WorktreeSetupFilesPort;
  ports: WorktreePortProbePort;
  repository: WorktreeSetupRepositoryPort;
  now?: () => string;
}

const NO_SETUP: WorktreeSetup = { state: 'none', ports: null, step: null, error: null, warning: null };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorktreeSetupRunner(deps: WorktreeSetupRunnerDeps): WorktreeSetupRunner {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
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
      const { config } = parsed;
      const worktreePath = record.path;
      const notes: string[] = [];
      const base: Omit<WorktreeSetupRecord, 'state' | 'step' | 'error' | 'warning' | 'updatedAt'> = {
        worktreeId: record.id,
        configHash: parsed.hash,
        portBase: null,
        portCount: null,
      };
      const fail = (step: string, error: string): WorktreeSetupRecord => deps.repository.upsert({
        ...base,
        state: 'failed',
        step,
        error,
        warning: notes.length ? notes.join('; ') : null,
        updatedAt: now(),
      });

      // Ports first: the block is stored at once so a concurrent create in
      // another repository cannot pick the same one while files are written.
      if (config.ports !== null) {
        const block = await allocatePortBlock(config.ports, deps.repository.listPortBlocks(), deps.ports.isFree);
        if (!block) {
          return fail('ports', `No free block of ${config.ports} ports between ${PORT_RANGE_START} and ${PORT_RANGE_END}`);
        }
        base.portBase = block.base;
        base.portCount = block.count;
        deps.repository.upsert({ ...base, state: 'running', step: 'files', error: null, warning: null, updatedAt: now() });
      }

      const variables: TemplateVariables = {
        port: base.portBase,
        name: record.name,
        slug: worktreeSlug(record.name),
        key: worktreeKey(record.name, record.id),
        id: record.id,
        path: worktreePath,
        rootPath: repositoryTopLevel,
      };

      // Every check runs before any write, so a refused entry leaves the
      // worktree exactly as Git created it.
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
        if (refused.length) return fail('check', refused.join('; '));
      } catch (error: unknown) {
        return fail('check', messageOf(error));
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
        return fail(step, messageOf(error));
      }

      return deps.repository.upsert({
        ...base,
        state: 'ready',
        step: null,
        error: null,
        warning: notes.length ? notes.join('; ') : null,
        updatedAt: now(),
      });
    },

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
  };
}
