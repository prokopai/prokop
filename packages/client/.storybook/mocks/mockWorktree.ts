import type { GitWorktreeRef, ManagedWorktree } from '@prokopai/sdk';
import { mockId, mockIsoNow, merge } from './mockHelpers';

// =============================================================================
// Managed Worktree Factory
// =============================================================================

export type MockWorktreeOverrides = Partial<ManagedWorktree>;

export function createWorktree(overrides: MockWorktreeOverrides = {}): ManagedWorktree {
  const id = overrides.id ?? mockId('wt');
  return merge<ManagedWorktree>(
    {
      id,
      name: `worktree-${id}`,
      workspaceId: mockId('ws'),
      repositoryId: mockId('repo'),
      path: `/home/user/.prokopai/worktrees/${id}`,
      branch: 'feature/drywall',
      head: 'abc1234',
      state: 'available',
      dirty: false,
      untrackedCount: 0,
      attachments: [],
      setup: { state: 'none', ports: null, step: null, error: null, warning: null, commands: { setup: [], teardown: [] } },
      createdAt: mockIsoNow(),
      updatedAt: mockIsoNow(),
    },
    overrides,
  );
}

export const worktreePresets = {
  clean: createWorktree({ name: 'feature-login', branch: 'feature/login' }),
  dirty: createWorktree({
    name: 'fix-auth-flow',
    branch: 'fix/auth-flow',
    dirty: true,
    untrackedCount: 3,
    attachments: [
      { sessionId: mockId('sess'), title: 'Fixing auth', running: true },
    ],
  }),
  missing: createWorktree({
    name: 'old-experiment',
    branch: 'experiment/old',
    state: 'missing',
  }),
  detached: createWorktree({ name: 'detached-ref', branch: null }),
  settingUp: createWorktree({
    name: 'api-rate-limit',
    branch: 'feature/api-rate-limit',
    setup: {
      state: 'running',
      ports: { base: 20010, count: 10 },
      step: 'setup 1/2: bun install',
      error: null,
      warning: null,
      commands: { setup: ['bun install', 'bun run db:create'], teardown: ['bun run db:drop'] },
    },
  }),
  needsApproval: createWorktree({
    name: 'search-index',
    branch: 'feature/search-index',
    setup: {
      state: 'needs_approval',
      ports: { base: 20020, count: 10 },
      step: null,
      error: null,
      warning: null,
      commands: { setup: ['bun install', 'bun run db:create'], teardown: ['bun run db:drop'] },
    },
  }),
  setupFailed: createWorktree({
    name: 'fix-auth',
    branch: 'fix/auth',
    setup: {
      state: 'failed',
      ports: { base: 20030, count: 10 },
      step: 'setup 2/2: bun run db:create',
      error: 'exit code 1\nerror: database "app_fix_auth_1a2b3c" already exists',
      warning: null,
      commands: { setup: ['bun install', 'bun run db:create'], teardown: ['bun run db:drop'] },
    },
  }),
  ready: createWorktree({
    name: 'docs-refresh',
    branch: 'docs/refresh',
    setup: {
      state: 'ready',
      ports: { base: 20040, count: 10 },
      step: null,
      error: null,
      warning: 'skipped clone node_modules: not in the primary checkout',
      commands: { setup: ['bun install'], teardown: [] },
    },
  }),
} as const;

// =============================================================================
// Git Worktree Ref Factory
// =============================================================================

export type MockRefOverrides = Partial<GitWorktreeRef>;

export function createRef(overrides: MockRefOverrides = {}): GitWorktreeRef {
  return merge<GitWorktreeRef>(
    {
      name: 'main',
      ref: 'refs/heads/main',
      kind: 'local',
      commit: 'def5678',
      current: false,
      checkedOut: false,
    },
    overrides,
  );
}

export const refPresets = {
  main: createRef({ name: 'main', current: true, checkedOut: true }),
  feature: createRef({ name: 'feature/drywall' }),
  fix: createRef({ name: 'fix/door-hinges' }),
  checkedOut: createRef({ name: 'feature/old', checkedOut: true }),
} as const;

export function createRefList(count = 5): GitWorktreeRef[] {
  return Array.from({ length: count }, (_, i) =>
    createRef({
      name: `feature/branch-${i + 1}`,
      ref: `refs/heads/feature/branch-${i + 1}`,
      current: i === 0,
      checkedOut: i === 1,
    }),
  );
}
