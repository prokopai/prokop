import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@prokopai/sdk';
import { createWorktreeApplication, type WorktreeApplication } from '@/application/worktrees';
import { createWorktreeSetupRunner } from '@/application/worktree-setup';
import { createWorktreeGitPort } from '@/infrastructure/git-worktrees';
import { createWorktreePortProbe, createWorktreeSetupFilesPort } from '@/infrastructure/worktree-setup';
import { initializeSchema } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { createWorktreeSetupRepository } from '@/infrastructure/sqlite/managed-worktree-setups';
import { PORT_RANGE_END, PORT_RANGE_START } from '@/domains/worktrees/port-blocks';

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...Bun.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  return result.stdout.toString();
}

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, () => resolve(server));
  });
}

describe('worktree setup from .prokop/worktree.json', () => {
  let root: string;
  let repositoryPath: string;
  let db: Database;
  let application: WorktreeApplication;
  let setupEvents: string[];
  const gitPort = createWorktreeGitPort();

  function writeConfig(config: unknown): void {
    mkdirSync(join(repositoryPath, '.prokop'), { recursive: true });
    writeFileSync(join(repositoryPath, '.prokop', 'worktree.json'), JSON.stringify(config));
  }

  async function create(name: string, branch: string) {
    const created = await application.create('workspace-1', { name, branch: `refs/heads/${branch}` });
    if (!created.ok) throw new Error(`${created.code}: ${created.message}`);
    return created.value;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'prokop-worktree-setup-'));
    repositoryPath = join(root, 'repository');
    mkdirSync(repositoryPath);
    git(repositoryPath, ['init', '-b', 'main']);
    git(repositoryPath, ['config', 'user.name', 'Prokop Test']);
    git(repositoryPath, ['config', 'user.email', 'prokop@example.invalid']);
    writeFileSync(join(repositoryPath, '.gitignore'), '.env\n.env.worktree\n.env.local\nnode_modules\ngenerated/\n');
    writeFileSync(join(repositoryPath, 'README.md'), '# Fixture\n');
    git(repositoryPath, ['add', '.']);
    git(repositoryPath, ['commit', '-m', 'Initial commit']);
    for (const branch of ['a', 'b', 'c', 'd']) git(repositoryPath, ['branch', `feature/${branch}`]);
    // The primary checkout's ignored data, the source of `copy` and `clone`.
    writeFileSync(join(repositoryPath, '.env'), 'SECRET=primary\n');

    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    initializeSchema(db);
    db.run(
      'INSERT INTO workspaces (id, name, path, is_virtual, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ['workspace-1', 'Workspace', repositoryPath, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    );

    const sessions = new Map<string, Session>();
    setupEvents = [];
    application = createWorktreeApplication({
      dataDir: () => join(root, 'data'),
      repository: createManagedWorktreeRepository(() => db),
      git: gitPort,
      setup: createWorktreeSetupRunner({
        files: createWorktreeSetupFilesPort(),
        ports: createWorktreePortProbe(),
        repository: createWorktreeSetupRepository(() => db),
      }),
      workspaces: {
        get: (id) => id === 'workspace-1'
          ? {
              id,
              name: 'Workspace',
              path: repositoryPath,
              isVirtual: false,
              additionalPaths: [],
              settings: {},
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }
          : null,
      },
      sessions: {
        get: (id) => sessions.get(id) ?? null,
        listByWorkspace: () => [...sessions.values()],
        updateWorkspaceRoot: () => null,
        hasMessages: () => false,
        isRunning: () => false,
      },
      terminals: { listForWorktree: () => [], clearWorktreeReferences: () => {} },
      events: {
        worktreeChanged: (worktree) => setupEvents.push(`${worktree.state}:${worktree.setup.state}`),
        worktreeDeleted: () => setupEvents.push('deleted'),
        sessionChanged: () => {},
      },
    });
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  test('copies ignored files, renders env and template files with the port, and keeps the worktree clean', async () => {
    writeConfig({
      copy: ['.env'],
      env: { PORT: '{{port}}', API_PORT: '{{port+1}}', DATABASE_NAME: 'app_{{key}}' },
      files: { '.env.local': 'NEXT_PUBLIC_API=http://localhost:{{port+1}}\n', 'generated/name.txt': '{{name}}' },
    });

    const worktree = await create('Fix auth flow', 'feature/a');

    expect(worktree.setup.state).toBe('ready');
    expect(worktree.setup.error).toBeNull();
    expect(worktree.setup.warning).toBeNull();
    const ports = worktree.setup.ports;
    expect(ports).not.toBeNull();
    if (!ports) return;
    expect(ports.count).toBe(10);
    expect(ports.base).toBeGreaterThanOrEqual(PORT_RANGE_START);
    expect(ports.base + ports.count - 1).toBeLessThanOrEqual(PORT_RANGE_END);
    expect((ports.base - PORT_RANGE_START) % 10).toBe(0);

    expect(readFileSync(join(worktree.path, '.env'), 'utf8')).toBe('SECRET=primary\n');
    const key = `fix_auth_flow_${worktree.id.replace(/-/g, '').slice(0, 6)}`;
    expect(readFileSync(join(worktree.path, '.env.worktree'), 'utf8'))
      .toBe(`API_PORT=${ports.base + 1}\nDATABASE_NAME=app_${key}\nPORT=${ports.base}\n`);
    expect(readFileSync(join(worktree.path, '.env.local'), 'utf8'))
      .toBe(`NEXT_PUBLIC_API=http://localhost:${ports.base + 1}\n`);
    expect(readFileSync(join(worktree.path, 'generated', 'name.txt'), 'utf8')).toBe('Fix auth flow');

    // Everything written is ignored, so the worktree is as clean as Git made it.
    expect(await gitPort.status(worktree.path)).toMatchObject({ dirty: false, untrackedCount: 0 });
    expect(setupEvents).toEqual(['available:ready']);

    const removed = await application.remove('workspace-1', worktree.id);
    expect(removed.ok).toBe(true);
    expect(existsSync(worktree.path)).toBe(false);
  });

  test('refuses a copy target that is not ignored, writes nothing, and keeps the worktree removable', async () => {
    writeFileSync(join(repositoryPath, 'notes.txt'), 'tracked elsewhere\n');
    writeConfig({ copy: ['.env', 'notes.txt'], files: { '.env.local': 'A=1\n' } });

    const worktree = await create('refused', 'feature/a');

    expect(worktree.state).toBe('available');
    expect(worktree.setup).toEqual({
      state: 'failed',
      ports: null,
      step: 'check',
      error: 'add notes.txt to .gitignore, otherwise the worktree turns dirty and cannot be removed',
      warning: null,
    });
    expect(existsSync(join(worktree.path, '.env'))).toBe(false);
    expect(existsSync(join(worktree.path, '.env.local'))).toBe(false);
    expect(existsSync(join(worktree.path, 'notes.txt'))).toBe(false);
    expect((await application.remove('workspace-1', worktree.id)).ok).toBe(true);
  });

  test('refuses a clone target that is not ignored', async () => {
    mkdirSync(join(repositoryPath, 'vendor'));
    writeFileSync(join(repositoryPath, 'vendor', 'lib.js'), 'x\n');
    writeConfig({ clone: ['vendor'] });

    const worktree = await create('clone-refused', 'feature/a');

    expect(worktree.setup.state).toBe('failed');
    expect(worktree.setup.error).toBe('add vendor to .gitignore, otherwise the worktree turns dirty and cannot be removed');
    expect(existsSync(join(worktree.path, 'vendor'))).toBe(false);
  });

  test('skips a copy source missing from the primary checkout with a note', async () => {
    writeConfig({ copy: ['.env', '.env.local'] });

    const worktree = await create('partial', 'feature/a');

    expect(worktree.setup.state).toBe('ready');
    expect(worktree.setup.warning).toBe('skipped copy .env.local: not in the primary checkout');
    expect(readFileSync(join(worktree.path, '.env'), 'utf8')).toBe('SECRET=primary\n');
  });

  test('refuses an invalid config before any worktree exists', async () => {
    writeConfig({ files: { '.env.local': 'X={{nope}}' } });

    const created = await application.create('workspace-1', { name: 'bad', branch: 'refs/heads/feature/a' });

    expect(created).toEqual({
      ok: false,
      code: 'worktree_config_invalid',
      message: '.prokop/worktree.json: "files..env.local" uses unknown template variable "{{nope}}"',
    });
    expect(existsSync(join(root, 'data'))).toBe(false);
    expect(db.query('SELECT COUNT(*) AS count FROM managed_worktrees').get()).toEqual({ count: 0 });
    expect(git(repositoryPath, ['worktree', 'list', '--porcelain']).split('\n\n').filter(Boolean)).toHaveLength(1);
  });

  test('three worktrees hold three distinct port blocks and a purged block is reused', async () => {
    writeConfig({ ports: 4, env: { PORT: '{{port}}' } });

    const first = await create('one', 'feature/a');
    const second = await create('two', 'feature/b');
    const third = await create('three', 'feature/c');
    const bases = [first, second, third].map((worktree) => worktree.setup.ports?.base ?? -1);
    expect(new Set(bases).size).toBe(3);
    expect(bases.every((base) => (base - PORT_RANGE_START) % 4 === 0)).toBe(true);

    // Removal keeps the block; only the purge releases it.
    expect((await application.remove('workspace-1', first.id)).ok).toBe(true);
    const whileRemoved = await create('four', 'feature/d');
    expect(whileRemoved.setup.ports?.base).not.toBe(first.setup.ports?.base);
    expect((await application.remove('workspace-1', whileRemoved.id)).ok).toBe(true);
    expect((await application.remove('workspace-1', whileRemoved.id)).ok).toBe(true);

    expect((await application.remove('workspace-1', first.id)).ok).toBe(true);
    expect(db.query('SELECT COUNT(*) AS count FROM managed_worktree_setups').get()).toEqual({ count: 2 });
    const reused = await create('five', 'feature/a');
    expect(reused.setup.ports?.base).toBe(Math.min(first.setup.ports!.base, whileRemoved.setup.ports!.base));
  });

  test('a port with a listener is skipped during allocation', async () => {
    writeConfig({ ports: 2, env: { PORT: '{{port}}' } });
    const first = await create('one', 'feature/a');
    const nextBase = first.setup.ports!.base + 2;
    const server = await listen(nextBase + 1);
    try {
      const second = await create('two', 'feature/b');
      expect(second.setup.ports?.base).not.toBe(first.setup.ports?.base);
      expect(second.setup.ports?.base).not.toBe(nextBase);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test.skipIf(process.platform !== 'darwin')('clones a directory copy-on-write with relative symlinks intact', async () => {
    const modules = join(repositoryPath, 'node_modules');
    mkdirSync(join(modules, 'pkg'), { recursive: true });
    mkdirSync(join(modules, '.bin'));
    writeFileSync(join(modules, 'pkg', 'index.js'), 'module.exports = 1;\n');
    symlinkSync('../pkg/index.js', join(modules, '.bin', 'pkg'));
    writeConfig({ clone: ['node_modules'] });

    const worktree = await create('cloned', 'feature/a');

    expect(worktree.setup.state).toBe('ready');
    expect(worktree.setup.warning).toBeNull();
    expect(readFileSync(join(worktree.path, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 1;\n');
    expect(lstatSync(join(worktree.path, 'node_modules', '.bin', 'pkg')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(worktree.path, 'node_modules', '.bin', 'pkg'))).toBe('../pkg/index.js');
    expect(await gitPort.status(worktree.path)).toMatchObject({ dirty: false });
  });

  test('refuses a destination that a symlink would carry outside the worktree', async () => {
    writeConfig({ files: { 'generated/out.txt': 'x' } });
    // Pre-create the ignored directory in the fresh worktree as a link out,
    // using a branch whose checkout we prepare after Git creates it: the
    // files port must see the link, not follow it.
    const outside = join(root, 'outside');
    mkdirSync(outside);
    const files = createWorktreeSetupFilesPort();
    const worktreePath = join(root, 'probe-worktree');
    git(repositoryPath, ['worktree', 'add', worktreePath, 'feature/d']);
    symlinkSync(outside, join(worktreePath, 'generated'));

    expect(await files.isContained(worktreePath, 'generated/out.txt')).toBe(false);
    expect(await files.isContained(worktreePath, 'generated')).toBe(false);
    expect(await files.isContained(worktreePath, 'other/out.txt')).toBe(true);
    expect(await files.sourceExists(repositoryPath, '.env')).toBe(true);
    expect(await files.sourceExists(repositoryPath, 'missing')).toBe(false);
  });
});
