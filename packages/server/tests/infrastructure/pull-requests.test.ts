import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePullRequestRemote } from '@/infrastructure/pull-requests/repositories';
import { createGitHubPullRequests } from '@/infrastructure/pull-requests/github';
import { createGitHubCredentials, githubRest, type GitHubApi } from '@/infrastructure/pull-requests/github-rest';
import { createAzurePullRequests } from '@/infrastructure/pull-requests/azure';
import { runCli, type CliRequest, type RunCli } from '@/infrastructure/pull-requests/cli';
import {
  AzureSetupError,
  azureRest,
  createAzureCredentials,
  type AzureApi,
  type AzureRequest,
  type FetchLike,
} from '@/infrastructure/pull-requests/azure-rest';
import { BadRequestError, ConflictError } from '@/application/http-errors';
import { pullRequestActionSchema, pullRequestCreateSchema } from '@/transport/http/routes/pull-requests';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const githubRepo = parsePullRequestRemote('origin', 'git@github.com:acme/project.git')!;
const azureRepo = parsePullRequestRemote('origin', 'git@ssh.dev.azure.com:v3/acme/Product/App')!;
const ghPr = {
  number: 7,
  title: 'Feature',
  body: 'Description',
  html_url: 'https://github.com/acme/project/pull/7',
  user: { id: 1, login: 'alice' },
  state: 'open',
  draft: false,
  head: { ref: 'feature', sha: head },
  base: { ref: 'main', sha: base, repo: { full_name: 'acme/project' } },
  updated_at: '2026-10-08T00:00:00Z',
  requested_reviewers: [],
  node_id: 'PR_7',
  mergeable: true,
};
const azPr = {
  pullRequestId: 7,
  title: 'Feature',
  description: 'Description',
  createdBy: { id: 'alice-id', displayName: 'Alice' },
  status: 'active',
  isDraft: false,
  sourceRefName: 'refs/heads/feature',
  targetRefName: 'refs/heads/main',
  lastMergeSourceCommit: { commitId: head },
  lastMergeTargetCommit: { commitId: base },
  creationDate: '2026-10-08T00:00:00Z',
  reviewers: [],
  repository: { project: { id: 'project-id' } },
  mergeStatus: 'succeeded',
};
const guard = { expectedHead: head, accountId: 'alice-id' };

describe('repository identity', () => {
  test.each([
    ['https://github.com/Acme/Project.git', 'github:acme/project'],
    ['ssh://git@github.com/acme/project.git', 'github:acme/project'],
    ['git@ssh.dev.azure.com:v3/acme/Product/App', 'azure:acme/product/app'],
    ['acme@vs-ssh.visualstudio.com:v3/acme/Product/App', 'azure:acme/product/app'],
    ['ssh://acme@vs-ssh.visualstudio.com/v3/acme/Product/App', 'azure:acme/product/app'],
    ['https://dev.azure.com/acme/My%20Project/_git/App', 'azure:acme/my project/app'],
    ['https://acme.visualstudio.com/Product/_git/App', 'azure:acme/product/app'],
  ])('%s resolves to a canonical repository', (url, key) =>
    expect(parsePullRequestRemote('origin', url)?.key).toBe(key),
  );
  test.each([
    'https://github.com.evil.test/acme/repo',
    'https://github.com:444/acme/repo',
    'https://user:secret@github.com/acme/repo',
    'http://github.com/acme/repo',
    'https://dev.azure.com/acme/project/_git/%2Fsecret',
    'file:///repo',
    'https://github.com/acme/repo/extra',
    'git@vs-ssh.visualstudio.com.evil.test:v3/acme/Product/App',
    'git@vs-ssh.visualstudio.com:v3/acme/Product',
  ])('rejects unsafe or unsupported remote %s', (url) =>
    expect(parsePullRequestRemote('origin', url)).toBeNull(),
  );
  test('legacy Azure SSH identifies the organization from the path, not the SSH user', () => {
    expect(
      parsePullRequestRemote('origin', 'other-user@vs-ssh.visualstudio.com:v3/acme/Product/App'),
    ).toMatchObject({
      provider: 'azure',
      host: 'dev.azure.com',
      owner: 'acme',
      project: 'Product',
      name: 'App',
      url: 'https://dev.azure.com/acme/Product/_git/App',
    });
  });
});

interface GitHubCall {
  path: string;
  method: string;
  body?: unknown;
}
function githubHarness(answer: (call: GitHubCall) => unknown = () => ghPr) {
  const calls: GitHubCall[] = [];
  const api: GitHubApi = async (path, method = 'GET', body) => {
    const call = { path, method, ...(body === undefined ? {} : { body }) };
    calls.push(call);
    return structuredClone(answer(call));
  };
  return { calls, provider: createGitHubPullRequests(api, githubRepo) };
}
const graphPr = {
  number: 7,
  title: 'Feature',
  body: 'Description',
  url: 'https://github.com/acme/project/pull/7',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'feature',
  baseRefName: 'main',
  headRefOid: head,
  baseRefOid: base,
  updatedAt: '2026-10-08T00:00:00Z',
  mergeable: 'MERGEABLE',
  author: { __typename: 'User', login: 'alice', databaseId: 1 },
  autoMergeRequest: null,
  reviewRequests: {
    nodes: [
      { requestedReviewer: { __typename: 'User', login: 'carol', databaseId: 3 } },
      { requestedReviewer: { __typename: 'Team' } },
    ],
  },
  comments: {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        databaseId: 11,
        body: 'Coverage report',
        createdAt: '2026-10-08T02:00:00Z',
        author: { __typename: 'Bot', login: 'codecov', databaseId: 9 },
      },
    ],
  },
  reviews: {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        databaseId: 21,
        state: 'CHANGES_REQUESTED',
        body: 'Please add tests',
        submittedAt: '2026-10-08T01:00:00Z',
        author: { __typename: 'User', login: 'bob', databaseId: 2 },
      },
      { databaseId: 22, state: 'PENDING', body: 'draft', submittedAt: null, author: null },
    ],
  },
  reviewThreads: {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        id: 'T_1',
        path: 'src/a.ts',
        line: 4,
        diffSide: 'RIGHT',
        isResolved: false,
        isOutdated: false,
        viewerCanResolve: true,
        viewerCanUnresolve: false,
        comments: {
          pageInfo: { hasNextPage: false },
          nodes: [{ databaseId: 31, body: 'Why?', createdAt: '2026-10-08T03:00:00Z', author: null }],
        },
      },
    ],
  },
  commits: {
    nodes: [
      {
        commit: {
          oid: head,
          statusCheckRollup: {
            contexts: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  __typename: 'CheckRun',
                  name: 'test',
                  status: 'COMPLETED',
                  conclusion: 'FAILURE',
                  permalink: 'https://github.com/acme/project/runs/1',
                },
                { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: null, permalink: '' },
                { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS', targetUrl: null },
              ],
            },
          },
        },
      },
    ],
  },
};
const graphDetail = (pullRequest: unknown = graphPr, errors?: unknown[]) => ({
  data: {
    repository: {
      mergeCommitAllowed: false,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      pullRequest,
    },
  },
  ...(errors ? { errors } : {}),
});

describe('GitHub adapter', () => {
  test('create sends the description verbatim as JSON, never through a shell', async () => {
    const { provider, calls } = githubHarness((call) => (call.body ? ghPr : { full_name: 'acme/project' }));
    const body = 'literal $(touch nope) `hello`\nsecond line';
    await provider.create({
      title: 'Feature',
      body,
      sourceBranch: 'alice:feature',
      targetBranch: 'main',
      draft: true,
      accountId: '1',
    });
    expect(calls[1]).toMatchObject({ path: 'repos/acme/project/pulls', method: 'POST' });
    expect(calls[1].body).toMatchObject({ body, head: 'alice:feature', draft: true });
  });
  test('writes to a renamed or transferred repository target its canonical name', async () => {
    const moved = { ...ghPr, base: { ...ghPr.base, repo: { full_name: 'new-org/renamed' } } };
    const { provider, calls } = githubHarness((call) => {
      if (call.body) return call.method === 'PUT' ? { merged: true } : moved;
      return call.path === 'repos/acme/project' ? { full_name: 'new-org/renamed' } : moved;
    });
    await provider.action(7, { ...guard, action: 'merge', method: 'squash' });
    expect(calls.map((c) => c.path)).toEqual(['repos/acme/project/pulls/7', 'repos/new-org/renamed/pulls/7/merge']);
    calls.length = 0;
    await provider.create({
      title: 'Feature',
      body: '',
      sourceBranch: 'feature',
      targetBranch: 'main',
      draft: false,
      accountId: '1',
    });
    expect(calls.map((c) => c.path)).toEqual(['repos/acme/project', 'repos/new-org/renamed/pulls']);
  });
  test('an invalid canonical repository name blocks the write', async () => {
    const { provider, calls } = githubHarness(() => ({
      ...ghPr,
      base: { ...ghPr.base, repo: { full_name: 'a/b/c' } },
    }));
    await expect(provider.action(7, { ...guard, action: 'close' })).rejects.toThrow('invalid repository name');
    expect(calls).toHaveLength(1);
  });
  test('rejects a stale merge without executing any write', async () => {
    const { provider, calls } = githubHarness();
    await expect(
      provider.action(7, { ...guard, expectedHead: base, action: 'merge', method: 'squash' }),
    ).rejects.toThrow('changed');
    expect(calls).toEqual([{ path: 'repos/acme/project/pulls/7', method: 'GET' }]);
  });
  test('merge sends an atomic expected SHA and verifies merged=true', async () => {
    const { provider, calls } = githubHarness((call) => (call.body ? { merged: false } : ghPr));
    await expect(provider.action(7, { ...guard, action: 'merge', method: 'squash' })).rejects.toThrow(
      'did not merge',
    );
    expect(calls[1].body).toEqual({ sha: head, merge_method: 'squash' });
  });
  test('inline review uses the displayed commit and diff side', async () => {
    const { provider, calls } = githubHarness((call) => (call.body ? {} : ghPr));
    await provider.action(7, {
      ...guard,
      action: 'comment',
      body: 'Why?',
      position: { path: 'src/a.ts', line: 9, side: 'LEFT' },
    });
    expect(calls[1].body).toMatchObject({ commit_id: head, path: 'src/a.ts', line: 9, side: 'LEFT' });
  });
  test('denies thread IDs belonging to another pull request', async () => {
    const { provider, calls } = githubHarness((call) =>
      call.body
        ? {
            data: {
              repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } },
            },
          }
        : ghPr,
    );
    await expect(
      provider.action(7, { ...guard, action: 'resolve', threadId: 'foreign', resolved: true }),
    ).rejects.toThrow('not part');
    expect(calls).toHaveLength(2);
  });
  test('malformed provider data fails instead of becoming a green or empty PR', async () => {
    const { provider } = githubHarness(() => ({ ...ghPr, state: 'surprise' }));
    await expect(provider.summary(7)).rejects.toThrow('invalid PR state');
    const graph = githubHarness(() => graphDetail({ ...graphPr, state: 'SURPRISE' }));
    await expect(graph.provider.detail(7)).rejects.toThrow('invalid PR state');
  });
  test('merged pagination advances by raw rows even when page contains only abandoned PRs', async () => {
    const { provider } = githubHarness(() => Array.from({ length: 30 }, () => ({ ...ghPr, state: 'closed' })));
    expect(await provider.list('merged', 1)).toEqual({ items: [], nextPage: 2 });
  });
  test('detail loads everything in one GraphQL request', async () => {
    const { provider, calls } = githubHarness(() => graphDetail());
    const detail = await provider.detail(7);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: 'graphql', method: 'POST' });
    expect(calls[0].body).toMatchObject({ variables: { owner: 'acme', name: 'project', number: 7 } });
    expect(detail).toMatchObject({
      number: 7,
      state: 'open',
      head,
      base,
      author: { id: '1', name: 'alice' },
      requestedReviewerIds: ['3'],
      mergeability: 'mergeable',
      mergeMethods: ['squash', 'rebase'],
      autoMerge: false,
      warnings: [],
    });
    expect(detail.reviewers).toEqual([
      { id: '2', name: 'bob', vote: 'CHANGES_REQUESTED' },
      { id: '3', name: 'carol', vote: 'Review requested' },
    ]);
    // Review bodies join the conversation in time order; pending reviews stay private.
    expect(detail.comments.map((c) => [c.author.name, c.body])).toEqual([
      ['bob', 'Please add tests'],
      ['codecov[bot]', 'Coverage report'],
    ]);
    expect(detail.threads[0]).toMatchObject({
      id: 'T_1',
      path: 'src/a.ts',
      line: 4,
      canResolve: true,
      comments: [{ author: { id: 'deleted', name: 'Deleted user' }, body: 'Why?' }],
    });
    expect(detail.checks).toEqual([
      { name: 'test', state: 'failure', url: 'https://github.com/acme/project/runs/1' },
      { name: 'lint', state: 'in_progress', url: '' },
      { name: 'ci/legacy', state: 'success', url: '' },
    ]);
  });
  test('a section GitHub cannot resolve becomes a warning instead of failing the PR', async () => {
    const { provider } = githubHarness(() =>
      graphDetail({ ...graphPr, commits: null, reviews: null }, [
        { path: ['repository', 'pullRequest', 'commits'], message: 'Resource not accessible' },
        { path: ['repository', 'pullRequest', 'reviews'], message: 'Resource not accessible' },
      ]),
    );
    const detail = await provider.detail(7);
    expect(detail.title).toBe('Feature');
    expect(detail.checks).toEqual([]);
    expect(detail.reviewers).toEqual([{ id: '3', name: 'carol', vote: 'Review requested' }]);
    expect(detail.warnings).toEqual([
      'Checks unavailable. Refresh or open on GitHub.',
      'Reviews unavailable. Refresh or open on GitHub.',
    ]);
  });
  test('checks for an older commit are not shown as the current head', async () => {
    const stale = { nodes: [{ commit: { ...graphPr.commits.nodes[0].commit, oid: base } }] };
    const { provider } = githubHarness(() => graphDetail({ ...graphPr, commits: stale }));
    const detail = await provider.detail(7);
    expect(detail.checks).toEqual([]);
    expect(detail.warnings).toEqual(['Checks unavailable. Refresh or open on GitHub.']);
  });
  test('truncated activity is reported', async () => {
    const { provider } = githubHarness(() =>
      graphDetail({ ...graphPr, comments: { ...graphPr.comments, pageInfo: { hasNextPage: true } } }),
    );
    expect((await provider.detail(7)).warnings).toEqual([
      'Some activity may be omitted. Open on GitHub for the full history.',
    ]);
  });
  test('a missing pull request fails clearly', async () => {
    const { provider } = githubHarness(() => graphDetail(null, [{ type: 'NOT_FOUND', path: ['repository'] }]));
    await expect(provider.detail(7)).rejects.toThrow('could not load this pull request');
  });
  test('changed files carry their patch, so opening a file needs no request', async () => {
    const { provider, calls } = githubHarness((call) =>
      call.path.includes('/files')
        ? [
            { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' },
            { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
          ]
        : ghPr,
    );
    const result = await provider.files(7, head, 1);
    expect(calls.map((c) => c.path)).toEqual([
      'repos/acme/project/pulls/7/files?per_page=30&page=1',
      'repos/acme/project/pulls/7',
    ]);
    expect(result.files[0].diff).toEqual({
      patch: 'diff --git "a/src/a.ts" "b/src/a.ts"\n--- "a/src/a.ts"\n+++ "b/src/a.ts"\n@@ -1 +1 @@\n-a\n+b\n',
    });
    expect(result.files[1].diff).toMatchObject({ patch: '', unavailable: expect.stringContaining('binary') });
  });
  test('a push while listing files is a conflict', async () => {
    const { provider } = githubHarness((call) =>
      call.path.includes('/files') ? [] : { ...ghPr, head: { ...ghPr.head, sha: base } },
    );
    await expect(provider.files(7, head, 1)).rejects.toThrow('changed');
  });
});

describe('GitHub REST transport', () => {
  const user = { id: 1, login: 'alice' };
  function transport(response: (url: string, init: RequestInit) => Response = () => Response.json(user)) {
    const cli: CliRequest[] = [];
    const requests: { url: string; init: RequestInit }[] = [];
    let token = 'token-1';
    let clock = 0;
    const run: RunCli = async (request) => {
      cli.push(request);
      return `${token}\n`;
    };
    const fetcher: FetchLike = async (url, init) => {
      requests.push({ url, init });
      return response(url, init);
    };
    const credentials = createGitHubCredentials(run, () => clock);
    return {
      cli,
      requests,
      api: githubRest(fetcher, credentials),
      switchAccount: (next: string) => {
        token = next;
      },
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }
  const header = (init: RequestInit) => (init.headers as Record<string, string>).authorization;

  test('reads the gh token once and calls the API directly', async () => {
    const { cli, requests, api } = transport();
    await Promise.all([api('repos/acme/project/pulls/7'), api('repos/acme/project/pulls/8')]);
    expect(cli).toHaveLength(1);
    expect(cli[0].args).toEqual(['auth', 'token', '--hostname', 'github.com']);
    expect(requests[0].url).toBe('https://api.github.com/repos/acme/project/pulls/7');
    expect(header(requests[0].init)).toBe('Bearer token-1');
  });
  test('identifies the account once per token and notices an account switch', async () => {
    const { requests, api, switchAccount, advance } = transport((_url, init) =>
      Response.json(header(init) === 'Bearer token-2' ? { id: 2, login: 'bob' } : user),
    );
    await api('user');
    await api('user');
    expect(requests).toHaveLength(1);
    switchAccount('token-2');
    advance(10_001);
    expect(await api('user')).toEqual({ id: 2, login: 'bob' });
    expect(requests).toHaveLength(2);
  });
  test('sends JSON bodies with the requested method', async () => {
    const { requests, api } = transport(() => Response.json({}));
    await api('graphql', 'POST', { query: 'q' });
    expect(requests[0].init).toMatchObject({ method: 'POST', body: '{"query":"q"}' });
  });
  test('a rejected token asks for gh auth login and is read again', async () => {
    let status = 401;
    const { cli, api } = transport(() => Response.json({ message: 'Bad credentials' }, { status }));
    await expect(api('user')).rejects.toThrow('gh auth login');
    status = 200;
    await api('repos/acme/project');
    expect(cli).toHaveLength(2);
  });
  test('a failed gh sign-in is not cached', async () => {
    let signedIn = false;
    const cli: CliRequest[] = [];
    const run: RunCli = async (request) => {
      cli.push(request);
      if (!signedIn)
        throw new BadRequestError(request.classify?.('no oauth token found for github.com') ?? 'generic');
      return 'token';
    };
    const api = githubRest(async () => Response.json(user), createGitHubCredentials(run));
    await expect(api('user')).rejects.toThrow('gh auth login');
    signedIn = true;
    await api('user');
    expect(cli).toHaveLength(2);
  });
  test.each([
    [Response.json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'rate limit'],
    [Response.json({}, { status: 429 }), 'rate limit'],
    [Response.json({ message: 'A pull request already exists for acme:feature.' }, { status: 422 }), 'already exists'],
    [Response.json({}, { status: 404 }), 'could not find'],
  ])('classifies provider failures %#', async (failure, message) => {
    const { api } = transport(() => failure);
    await expect(api('repos/acme/project/pulls', 'POST', {})).rejects.toThrow(message);
  });
  test('a conflicting write is a conflict', async () => {
    const { api } = transport(() => Response.json({ message: 'Head branch was modified.' }, { status: 409 }));
    await expect(api('repos/acme/project/pulls/7/merge', 'PUT', {})).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('CLI error classification', () => {
  test('a provider redirect explains the moved repository instead of a generic failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prokop-gh-'));
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho "gh: HTTP 307" >&2\nexit 1\n', { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${dir}:${path}`;
    try {
      await expect(runCli({ command: 'gh', args: ['api'], cwd: dir })).rejects.toThrow(
        'repository moved',
      );
    } finally {
      process.env.PATH = path;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function azureHarness(answer?: (request: AzureRequest) => unknown) {
  const calls: AzureRequest[] = [];
  const api: AzureApi = async (request) => {
    calls.push(request);
    const result =
      answer?.(request) ??
      (/^pullrequests\/\d+$/.test(request.path)
        ? azPr
        : request.path.endsWith('/iterations')
          ? { value: [{ id: 3, sourceRefCommit: { commitId: head }, commonRefCommit: { commitId: base } }] }
          : {});
    return structuredClone(result);
  };
  const writes = () => calls.filter((c) => c.method && c.method !== 'GET');
  return { calls, writes, provider: createAzurePullRequests(api, azureRepo) };
}

describe('Azure adapter', () => {
  test('renamed patches read the original path at the common commit', async () => {
    const { provider, calls } = azureHarness((request) => {
      if (request.path.endsWith('/changes'))
        return {
          changeEntries: [
            {
              item: { path: '/new.ts' },
              sourceServerItem: '/old.ts',
              changeType: 'edit, rename',
              changeTrackingId: 8,
            },
          ],
          nextSkip: 0,
        };
      if (request.path === 'items')
        return {
          content: request.query?.['versionDescriptor.version'] === base ? 'old\n' : 'new\n',
          contentMetadata: { isBinary: false },
        };
    });
    const result = await provider.patch(7, head, '/new.ts');
    expect(result.patch).toContain('--- a/old.ts');
    expect(result.patch).toContain('+++ b/new.ts');
    const reads = calls.filter((c) => c.path === 'items');
    expect(reads.map((r) => [r.query?.path, r.query?.['versionDescriptor.version']])).toEqual([
      ['/old.ts', base],
      ['/new.ts', head],
    ]);
  });
  test.each([true, false])(
    'binary and oversized content are explicitly unavailable (binary=%s)',
    async (isBinary) => {
      const { provider } = azureHarness((request) => {
        if (request.path.endsWith('/changes'))
          return {
            changeEntries: [{ item: { path: '/file' }, changeType: 'add', changeTrackingId: 8 }],
            nextSkip: 0,
          };
        if (request.path === 'items')
          return { content: isBinary ? '' : 'x'.repeat(250_001), contentMetadata: { isBinary } };
      });
      expect(await provider.patch(7, head, '/file')).toMatchObject({
        patch: '',
        unavailable: expect.stringContaining('Binary or large'),
      });
    },
  );
  test('rejects patches if the source changes while reading file content', async () => {
    const { provider } = azureHarness((request) => {
      if (request.path === 'pullrequests/7')
        return { ...azPr, lastMergeSourceCommit: { commitId: base } };
      if (request.path.endsWith('/changes'))
        return {
          changeEntries: [{ item: { path: '/file' }, changeType: 'add', changeTrackingId: 8 }],
          nextSkip: 0,
        };
      if (request.path === 'items') return { content: 'hello', contentMetadata: { isBinary: false } };
    });
    await expect(provider.patch(7, head, '/file')).rejects.toThrow('changed');
  });
  test('folders are not listed as changed files', async () => {
    const { provider } = azureHarness((request) =>
      request.path.endsWith('/changes')
        ? {
            changeEntries: [
              { item: { path: '/src', isFolder: true }, changeType: 'add', changeTrackingId: 1 },
              { item: { path: '/src/a.ts' }, changeType: 'add', changeTrackingId: 2 },
            ],
          }
        : undefined,
    );
    expect((await provider.files(7, head, 1)).files.map((f) => f.path)).toEqual(['/src/a.ts']);
  });
  test('keeps file-level conversations and omits deleted and system-only threads', async () => {
    const author = { id: 'bob', displayName: 'Bob' };
    const { provider } = azureHarness((request) => {
      if (request.path.endsWith('/threads'))
        return {
          value: [
            { id: 1, threadContext: { filePath: '/a.ts' }, status: 'active', comments: [] },
            {
              id: 3,
              threadContext: { filePath: '/a.ts' },
              status: 'active',
              comments: [
                { id: 1, author, content: 'Why?', publishedDate: '2026-10-08', commentType: 'text' },
              ],
            },
            { id: 2, isDeleted: true },
            {
              id: 4,
              comments: [
                { id: 1, author, content: 'Bob voted 10', publishedDate: '2026-10-08', commentType: 'system' },
              ],
            },
          ],
        };
      if (request.path.endsWith('/statuses') || request.path === 'policy/evaluations') return { value: [] };
    });
    const detail = await provider.detail(7);
    expect(detail.threads).toEqual([
      {
        id: '3',
        path: '/a.ts',
        resolved: false,
        outdated: false,
        canResolve: true,
        comments: [{ id: '1', author: { id: 'bob', name: 'Bob' }, body: 'Why?', createdAt: '2026-10-08' }],
      },
    ]);
    expect(detail.warnings).toEqual([]);
  });
  test('build policies keep their configured names and optional policies are marked', async () => {
    const { provider } = azureHarness((request) =>
      request.path === 'policy/evaluations'
        ? {
            value: [
              {
                status: 'queued',
                configuration: {
                  isBlocking: true,
                  type: { displayName: 'Build' },
                  settings: { displayName: 'CI' },
                },
                context: { buildId: 42 },
              },
              { status: 'approved', configuration: { isBlocking: false, type: { displayName: 'Reviewers' } } },
            ],
          }
        : request.path.endsWith('/threads') || request.path.endsWith('/statuses')
          ? { value: [] }
          : undefined,
    );
    expect((await provider.detail(7)).checks).toEqual([
      { name: 'CI', state: 'queued', url: 'https://dev.azure.com/acme/Product/_build/results?buildId=42' },
      { name: 'Reviewers (optional)', state: 'approved' },
    ]);
  });
  test('a status without a state (Azure omits the default notSet) still loads the PR', async () => {
    const { provider } = azureHarness((request) =>
      request.path.endsWith('/statuses')
        ? { value: [{ id: 1, context: { name: 'codecoverage', genre: 'ci-gradle' } }] }
        : request.path.endsWith('/threads') || request.path === 'policy/evaluations'
          ? { value: [] }
          : undefined,
    );
    const detail = await provider.detail(7);
    expect(detail.checks).toEqual([{ name: 'ci-gradle/codecoverage', state: 'notSet', url: '' }]);
    expect(detail.warnings).toEqual([]);
  });
  test('a malformed check becomes a warning instead of failing the whole PR', async () => {
    const { provider } = azureHarness((request) =>
      request.path.endsWith('/statuses')
        ? { value: [{ id: 1, context: {} }] }
        : request.path.endsWith('/threads') || request.path === 'policy/evaluations'
          ? { value: [] }
          : undefined,
    );
    const detail = await provider.detail(7);
    expect(detail.number).toBe(7);
    expect(detail.checks).toEqual([]);
    expect(detail.warnings).toEqual(['Statuses unavailable. Refresh or open on Azure DevOps.']);
  });
  test('automatic completion uses the viewer identity and preserves policy enforcement', async () => {
    const { provider, writes } = azureHarness();
    await provider.action(7, { ...guard, action: 'enable-auto-merge', method: 'rebase-merge' });
    expect(writes().at(-1)?.body).toEqual({
      autoCompleteSetBy: { id: 'alice-id' },
      completionOptions: { mergeStrategy: 'rebaseMerge', deleteSourceBranch: false, bypassPolicy: false },
    });
  });
  test('disabling automatic completion sends the empty identity, which Azure treats as clear', async () => {
    const { provider, writes } = azureHarness();
    await provider.action(7, { ...guard, action: 'disable-auto-merge' });
    expect(writes().at(-1)?.body).toEqual({
      autoCompleteSetBy: { id: '00000000-0000-0000-0000-000000000000' },
    });
  });
  test('identifies the viewer from organization connection data', async () => {
    const { provider, calls } = azureHarness((request) =>
      request.path === 'connectionData'
        ? { authenticatedUser: { id: 'pat-user', providerDisplayName: 'Pat user' } }
        : undefined,
    );
    expect(await provider.account()).toEqual({ id: 'pat-user', name: 'Pat user' });
    expect(calls[0]).toMatchObject({ scope: 'organization', version: '7.1-preview' });
  });
  test('completion preserves head guard and never bypasses policy', async () => {
    const { provider, writes } = azureHarness();
    await provider.action(7, { ...guard, action: 'merge', method: 'rebase' });
    expect(writes()[0].body).toMatchObject({
      lastMergeSourceCommit: { commitId: head },
      completionOptions: { mergeStrategy: 'rebase', bypassPolicy: false, deleteSourceBranch: false },
    });
  });
  test('inline comment carries file tracking and iteration', async () => {
    const { provider, writes } = azureHarness();
    await provider.action(7, {
      ...guard,
      action: 'comment',
      body: 'Check this',
      position: { path: '/a.ts', line: 3, side: 'RIGHT', iteration: 3, changeTrackingId: 8 },
    });
    expect(writes().at(-1)).toMatchObject({
      path: 'pullrequests/7/threads',
      method: 'POST',
      body: {
        threadContext: { filePath: '/a.ts', rightFileStart: { line: 3, offset: 1 } },
        pullRequestThreadContext: {
          changeTrackingId: 8,
          iterationContext: { firstComparingIteration: 3, secondComparingIteration: 3 },
        },
      },
    });
  });
  test('rejects an outdated iteration before writing', async () => {
    const { provider, writes } = azureHarness();
    await expect(
      provider.action(7, {
        ...guard,
        action: 'comment',
        body: 'Check',
        position: { path: '/a.ts', line: 3, side: 'RIGHT', iteration: 2, changeTrackingId: 8 },
      }),
    ).rejects.toThrow('position changed');
    expect(writes()).toEqual([]);
  });
  test.each([
    ['approve', 10],
    ['approve-with-suggestions', 5],
    ['request-changes', -10],
    ['wait', -5],
    ['reset', 0],
  ] as const)('preserves Azure vote %s', async (verdict, vote) => {
    const { provider, writes } = azureHarness();
    await provider.action(7, { ...guard, action: 'review', verdict, body: '' });
    expect(writes().at(-1)).toMatchObject({
      path: 'pullrequests/7/reviewers/alice-id',
      method: 'PUT',
      body: { id: 'alice-id', vote },
    });
  });
  test('reports a partial review without silently reposting its successful comment', async () => {
    const { provider, calls } = azureHarness((request) => {
      if (request.path.includes('/reviewers/')) throw new Error('denied');
    });
    await expect(
      provider.action(7, { ...guard, action: 'review', verdict: 'approve', body: 'Looks good' }),
    ).rejects.toThrow('comment was posted');
    expect(calls.filter((c) => c.path.endsWith('/threads') && c.method === 'POST')).toHaveLength(1);
  });
  test('adds a reviewer by e-mail through an exact identity match', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const { provider, writes, calls } = azureHarness((request) =>
      request.path === 'identities' ? { value: [{ id }] } : undefined,
    );
    await provider.action(7, { ...guard, action: 'reviewer', reviewer: 'bob@example.com', remove: false });
    expect(calls.find((c) => c.path === 'identities')).toMatchObject({
      scope: 'identities',
      query: { searchFilter: 'General', filterValue: 'bob@example.com' },
    });
    expect(writes()).toEqual([
      { path: `pullrequests/7/reviewers/${id}`, method: 'PUT', body: { id, vote: 0 } },
    ]);
  });
  test('refuses an ambiguous reviewer instead of guessing', async () => {
    const { provider, writes } = azureHarness((request) =>
      request.path === 'identities' ? { value: [{ id: 'a' }, { id: 'b' }] } : undefined,
    );
    await expect(
      provider.action(7, { ...guard, action: 'reviewer', reviewer: 'bob', remove: false }),
    ).rejects.toThrow('several');
    expect(writes()).toEqual([]);
  });
  test('removes a reviewer identity without a lookup', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const { provider, writes, calls } = azureHarness();
    await provider.action(7, { ...guard, action: 'reviewer', reviewer: id, remove: true });
    expect(calls.some((c) => c.path === 'identities')).toBe(false);
    expect(writes()).toEqual([{ path: `pullrequests/7/reviewers/${id}`, method: 'DELETE' }]);
  });
});

describe('Azure REST transport', () => {
  const tenant = '479b24df-2b4c-4c28-9ced-2eebf82e9ab8';
  function transport({
    tenantHeader = tenant,
    accounts = [] as Record<string, unknown>[],
    token = (): unknown => ({ accessToken: 'token', expires_on: Math.floor(Date.now() / 1000) + 3600 }),
    response = (): Response => Response.json({ ok: true }),
    env = {} as Record<string, string>,
  } = {}) {
    const cli: CliRequest[] = [];
    const requests: { url: string; init: RequestInit }[] = [];
    const run: RunCli = async (request) => {
      cli.push(request);
      if (request.args[1] === 'list') return JSON.stringify(accounts);
      return JSON.stringify(token());
    };
    const fetcher: FetchLike = async (url, init) => {
      requests.push({ url, init });
      if (init.method === 'HEAD')
        return new Response(null, { status: 405, headers: { 'x-vss-resourcetenant': tenantHeader } });
      return response();
    };
    const credentials = createAzureCredentials(run, fetcher, env);
    return { cli, requests, api: azureRest(fetcher, credentials, azureRepo) };
  }
  const header = (init: RequestInit) => (init.headers as Record<string, string>).authorization;

  test("mints a token for the organization's own tenant, not the default az tenant", async () => {
    const { cli, requests, api } = transport();
    await api({ path: 'pullrequests/7' });
    expect(requests[0]).toMatchObject({ url: 'https://dev.azure.com/acme/_apis/connectionData' });
    expect(cli.at(-1)?.args).toEqual([
      'account',
      'get-access-token',
      '--resource',
      '499b84ac-1321-427f-aa17-267ca6975798',
      '--tenant',
      tenant,
      '--only-show-errors',
      '--output',
      'json',
    ]);
    expect(requests[1].url).toBe(
      'https://dev.azure.com/acme/Product/_apis/git/repositories/App/pullrequests/7?api-version=7.1',
    );
    expect(header(requests[1].init)).toBe('Bearer token');
  });
  test('prefers the az account signed in to that tenant over the default account', async () => {
    const { cli, api } = transport({
      accounts: [
        { id: 'default-sub', tenantId: 'other', isDefault: true },
        { id: 'tenant-sub', tenantId: tenant.toUpperCase(), isDefault: false },
      ],
    });
    await api({ path: 'pullrequests/7' });
    expect(cli.at(-1)?.args).toContain('tenant-sub');
    expect(cli.at(-1)?.args).not.toContain('--tenant');
  });
  test('organizations without a tenant use the default az account', async () => {
    const { cli, api } = transport({ tenantHeader: '00000000-0000-0000-0000-000000000000' });
    await api({ path: 'pullrequests/7' });
    expect(cli).toHaveLength(1);
    expect(cli[0].args).not.toContain('--tenant');
  });
  test('reuses one token across concurrent and later requests', async () => {
    const { cli, api } = transport({ tenantHeader: '' });
    await Promise.all([api({ path: 'a' }), api({ path: 'b' }), api({ path: 'c' })]);
    await api({ path: 'd' });
    expect(cli).toHaveLength(1);
  });
  test('identifies the viewer once per token', async () => {
    const { requests, api } = transport({ tenantHeader: '' });
    const identify = () => api({ path: 'connectionData', scope: 'organization', version: '7.1-preview' });
    await identify();
    await identify();
    expect(requests.filter((r) => r.init.method !== 'HEAD')).toHaveLength(1);
  });
  test('mints again when the cached token is about to expire', async () => {
    const { cli, api } = transport({
      tenantHeader: '',
      token: () => ({ accessToken: 'token', expires_on: Math.floor(Date.now() / 1000) + 60 }),
    });
    await api({ path: 'a' });
    await api({ path: 'b' });
    expect(cli).toHaveLength(2);
  });
  test('a tenant membership failure names the exact sign-in command', async () => {
    const run: RunCli = async (request) => {
      if (request.args[1] === 'list') return '[]';
      throw new BadRequestError(
        request.classify?.('AADSTS50020: User account does not exist in tenant') ?? 'generic',
      );
    };
    const fetcher: FetchLike = async () =>
      new Response(null, { status: 405, headers: { 'x-vss-resourcetenant': tenant } });
    const failure = await azureRest(fetcher, createAzureCredentials(run, fetcher, {}), azureRepo)({
      path: 'x',
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AzureSetupError);
    expect((failure as AzureSetupError).message).toContain('not a member');
    expect((failure as AzureSetupError).details).toEqual({
      command: `az login --tenant ${tenant} --allow-no-subscriptions`,
    });
  });
  test('a personal access token from AZURE_DEVOPS_EXT_PAT skips az entirely', async () => {
    const { cli, requests, api } = transport({ env: { AZURE_DEVOPS_EXT_PAT: 'pat' } });
    await api({ path: 'a' });
    expect(cli).toEqual([]);
    expect(header(requests.at(-1)!.init)).toBe(`Basic ${Buffer.from(':pat').toString('base64')}`);
  });
  test("surfaces Azure's own error message for rejected writes", async () => {
    const { api } = transport({
      response: () =>
        Response.json({ message: 'TF401179: An active pull request already exists.' }, { status: 409 }),
    });
    await expect(api({ path: 'pullrequests', method: 'POST', body: {} })).rejects.toThrow('TF401179');
  });
  test('an HTML sign-in page is an authentication failure, not data, and drops the token', async () => {
    let page = true;
    const { cli, api } = transport({
      tenantHeader: '',
      response: () =>
        page
          ? new Response('<html>Sign in</html>', { status: 203, headers: { 'content-type': 'text/html' } })
          : Response.json({}),
    });
    await expect(api({ path: 'a' })).rejects.toBeInstanceOf(AzureSetupError);
    page = false;
    await api({ path: 'a' });
    expect(cli).toHaveLength(2);
  });
  test('sends JSON bodies with the requested method and API version', async () => {
    const { requests, api } = transport({ tenantHeader: '' });
    await api({
      path: 'policy/evaluations',
      scope: 'project',
      query: { artifactId: 'vstfs:///x' },
      version: '7.1-preview.1',
    });
    await api({ path: 'pullrequests/7', method: 'PATCH', body: { title: 'New' } });
    expect(requests[1].url).toBe(
      'https://dev.azure.com/acme/Product/_apis/policy/evaluations?artifactId=vstfs%3A%2F%2F%2Fx&api-version=7.1-preview.1',
    );
    expect(requests[2].init).toMatchObject({ method: 'PATCH', body: '{"title":"New"}' });
  });
});

describe('wire validation', () => {
  const input = { ...guard, remote: 'origin', repositoryKey: githubRepo.key };
  test.each([
    { action: 'merge', method: 'squash', bypassPolicy: true },
    { action: 'comment', body: ' ' },
    { action: 'review', verdict: 'request-changes', body: '' },
    { action: 'reviewer', reviewer: '--admin', remove: false },
    { action: 'comment', body: 'hi', position: { path: 'a', line: 0, side: 'RIGHT' } },
  ])('rejects invalid action %#', (action) =>
    expect(pullRequestActionSchema.safeParse({ ...input, ...action }).success).toBe(false),
  );
  test('accepts a GitHub fork selector but rejects branch argument injection', () => {
    const create = {
      remote: 'origin',
      repositoryKey: githubRepo.key,
      title: 'Feature',
      body: '',
      sourceBranch: 'alice:feature',
      targetBranch: 'main',
      draft: true,
      accountId: '1',
    };
    expect(pullRequestCreateSchema.safeParse(create).success).toBe(true);
    expect(pullRequestCreateSchema.safeParse({ ...create, sourceBranch: '--admin' }).success).toBe(false);
    expect(
      pullRequestActionSchema.safeParse({
        ...input,
        action: 'merge',
        method: 'squash',
        expectedHead: 'a'.repeat(41),
      }).success,
    ).toBe(false);
  });
});
