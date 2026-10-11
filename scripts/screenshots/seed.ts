/**
 * Demo project setup: copies a fixture repo into the instance's fake home
 * and builds a short, plausible git history with fixed authors and dates.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type History = Array<{ message: string; paths: string[]; date: string }>;

/** linkshelf commits, replayed in order; each stages the listed paths. */
const LINKSHELF_HISTORY: History = [
  {
    message: 'Initial link store and redirect route',
    paths: ['package.json', 'tsconfig.json', 'README.md', 'src/store.ts', 'src/routes/redirect.ts', 'src/server.ts'],
    date: '2026-09-28T10:12:00+02:00',
  },
  {
    message: 'Add POST /api/links with url validation',
    paths: ['src/slug.ts', 'src/routes/links.ts', 'test/links.test.ts'],
    date: '2026-10-02T16:40:00+02:00',
  },
  {
    message: 'Cover redirects and click counting with tests',
    paths: ['test/redirect.test.ts'],
    date: '2026-10-07T09:05:00+02:00',
  },
];

/** invoicer, the second project: where the agent's memory of linkshelf shows. */
const INVOICER_HISTORY: History = [
  {
    message: 'Invoice model with amount formatting',
    // AGENTS.md also keeps Codex from searching the folders above the repo for one.
    paths: ['package.json', 'tsconfig.json', 'README.md', 'AGENTS.md', 'src/invoice.ts', 'test/invoice.test.ts'],
    date: '2026-10-05T14:20:00+02:00',
  },
];

export const DEMO_BRANCHES = ['feat/stats-expired-flag', 'feat/rate-limit', 'chore/build-script'] as const;

export const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Maya Chen',
  GIT_AUTHOR_EMAIL: 'maya@linkshelf.dev',
  GIT_COMMITTER_NAME: 'Maya Chen',
  GIT_COMMITTER_EMAIL: 'maya@linkshelf.dev',
};

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...GIT_IDENTITY, ...env },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
}

/** Copies `fixtures/<fixture>` to `<home>/code/<name>`, replays its history, and returns the path. */
function createRepo(home: string, name: string, fixture: string, history: History): string {
  const repo = join(home, 'code', name);
  mkdirSync(repo, { recursive: true });
  cpSync(join(import.meta.dir, 'fixtures', fixture), repo, { recursive: true });

  git(repo, ['init', '--quiet', '--initial-branch=main']);
  for (const commit of history) {
    git(repo, ['add', ...commit.paths]);
    git(repo, ['commit', '--quiet', '--no-verify', '-m', commit.message], {
      GIT_AUTHOR_DATE: commit.date,
      GIT_COMMITTER_DATE: commit.date,
    });
  }
  return repo;
}

/** Creates `<home>/code/linkshelf` and returns its path. */
export function createDemoRepo(home: string): string {
  const repo = createRepo(home, 'linkshelf', 'demo-repo', LINKSHELF_HISTORY);
  // Worktrees check out an existing branch, so create them up front.
  for (const branch of DEMO_BRANCHES) git(repo, ['branch', branch]);
  return repo;
}

/** Creates `<home>/code/invoicer` and returns its path. */
export function createInvoicerRepo(home: string): string {
  return createRepo(home, 'invoicer', 'invoicer', INVOICER_HISTORY);
}
