/**
 * The wire shape of a worktree's setup, the note a session bound to that
 * worktree gets at turn start, and the marker file agents can read. Pure.
 *
 * Agent awareness has two mechanisms, both here (docs/plans/worktree-setup.md
 * phase 5): the `.prokop/setup/state` marker, which every harness can read
 * without harness changes, and the turn-start notice, which names the state
 * so the model does not misread missing dependencies as its own problem.
 */

import type { WorktreeSetup } from '@prokopai/sdk';
import type { WorktreeSetupRecord } from '@/application/ports/worktree';

export const SETUP_MARKER_DIRECTORY = '.prokop/setup';
export const SETUP_MARKER_PATH = `${SETUP_MARKER_DIRECTORY}/state`;
export const SETUP_MARKER_IGNORE_PATH = `${SETUP_MARKER_DIRECTORY}/.gitignore`;

const NO_SETUP: WorktreeSetup = {
  state: 'none', ports: null, step: null, error: null, warning: null, commands: { setup: [], teardown: [] },
};

export function publicWorktreeSetup(record: WorktreeSetupRecord | null): WorktreeSetup {
  if (!record) return NO_SETUP;
  return {
    state: record.state,
    ports: record.portBase !== null && record.portCount !== null
      ? { base: record.portBase, count: record.portCount }
      : null,
    step: record.step,
    error: record.error,
    warning: record.warning,
    commands: record.commands,
  };
}

/**
 * Contents of `.prokop/setup/state` for a setup state: the first line is
 * the word agents branch on (`running`, `done`, `failed`, `pending`), the
 * rest is for reading. Null when nothing should be written.
 */
export function setupMarkerContent(setup: Pick<WorktreeSetup, 'state' | 'step' | 'error'>): string | null {
  switch (setup.state) {
    case 'none':
      return null;
    case 'running':
      return `running\n${setup.step ?? ''}\n`.replace(/\n\n$/, '\n');
    case 'ready':
      return 'done\n';
    case 'needs_approval':
      return 'pending\nSetup commands wait for the user\'s approval in Prokop. Dependencies may be missing until then.\n';
    case 'failed':
    case 'interrupted':
      return `failed\n${setup.step ? `${setup.step}\n` : ''}${setup.error ?? ''}\n`.replace(/\n\n$/, '\n');
    default:
      return null;
  }
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? text;
}

/** The turn-start note for a session bound to the worktree. Null for `ready` and `none`. */
export function worktreeSetupNotice(setup: Pick<WorktreeSetup, 'state' | 'step' | 'error' | 'commands'>): string | null {
  const marker = `\`${SETUP_MARKER_PATH}\` in the working directory`;
  switch (setup.state) {
    case 'running':
      return `[worktree] This worktree's setup is still running${setup.step ? ` (${setup.step})` : ''}. `
        + 'Missing dependencies or files are expected until it finishes. '
        + `Do not run your own install; ${marker} says \`running\` until it is done, then \`done\` or \`failed\` with the output tail. `
        + 'Wait for it before work that needs dependencies.';
    case 'needs_approval':
      return `[worktree] This worktree's setup commands (${setup.commands.setup.join('; ') || 'none'}) wait for the user's approval in Prokop and have not run. `
        + 'Dependencies may be missing until then; tell the user rather than installing on your own.';
    case 'failed':
    case 'interrupted':
      return `[worktree] This worktree's setup ${setup.state === 'interrupted' ? 'was interrupted' : 'failed'}`
        + `${setup.step ? ` at ${setup.step}` : ''}${setup.error ? `: ${firstLine(setup.error)}` : ''}. `
        + `Missing dependencies may come from that. The output tail is in ${marker}; the user can retry the setup from the Worktrees panel.`;
    default:
      return null;
  }
}
