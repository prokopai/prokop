import { describe, expect, test } from 'bun:test';
import {
  publicWorktreeSetup,
  SETUP_MARKER_PATH,
  setupMarkerContent,
  worktreeSetupNotice,
} from '@/domains/worktrees/setup-state';

const commands = { setup: ['bun install', 'bun run db:create'], teardown: [] };

describe('worktree setup state for agents', () => {
  test('the marker starts with one word an agent can branch on', () => {
    expect(setupMarkerContent({ state: 'running', step: 'setup 1/2: bun install', error: null }))
      .toBe('running\nsetup 1/2: bun install\n');
    expect(setupMarkerContent({ state: 'ready', step: null, error: null })).toBe('done\n');
    expect(setupMarkerContent({ state: 'failed', step: 'setup 2/2: bun run db:create', error: 'exit code 1\nno such database' }))
      .toBe('failed\nsetup 2/2: bun run db:create\nexit code 1\nno such database\n');
    // A kill still ends in `failed`, otherwise agents wait forever on `running`.
    expect(setupMarkerContent({ state: 'interrupted', step: 'setup 1/2: bun install', error: 'Setup was stopped before it finished' }))
      .toStartWith('failed\n');
    expect(setupMarkerContent({ state: 'needs_approval', step: null, error: null })).toStartWith('pending\n');
    expect(setupMarkerContent({ state: 'none', step: null, error: null })).toBeNull();
  });

  test('the notice names the state and the marker, and stays silent when ready', () => {
    const running = worktreeSetupNotice({ state: 'running', step: 'setup 1/2: bun install', error: null, commands });
    expect(running).toContain('still running (setup 1/2: bun install)');
    expect(running).toContain(SETUP_MARKER_PATH);
    expect(running).toContain('Do not run your own install');

    const failed = worktreeSetupNotice({ state: 'failed', step: 'setup 2/2: bun run db:create', error: 'exit code 1\nno such database', commands });
    expect(failed).toContain('failed at setup 2/2: bun run db:create: exit code 1');
    expect(failed).not.toContain('no such database');
    expect(failed).toContain('retry the setup from the Worktrees panel');

    expect(worktreeSetupNotice({ state: 'interrupted', step: null, error: null, commands })).toContain('was interrupted');
    expect(worktreeSetupNotice({ state: 'needs_approval', step: null, error: null, commands }))
      .toContain("commands (bun install; bun run db:create) wait for the user's approval");
    expect(worktreeSetupNotice({ state: 'ready', step: null, error: null, commands })).toBeNull();
    expect(worktreeSetupNotice({ state: 'none', step: null, error: null, commands })).toBeNull();
  });

  test('a missing record is the none state', () => {
    expect(publicWorktreeSetup(null)).toEqual({
      state: 'none', ports: null, step: null, error: null, warning: null, commands: { setup: [], teardown: [] },
    });
  });
});
