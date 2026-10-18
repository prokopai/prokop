// =============================================================================
// Git, file and pull request mock data for the Files & Git stories
// =============================================================================

import type {
  EditableFileResponse,
  FilePreviewResponse,
  FileTreeResponse,
  GitBranchesResult,
  GitBranchInfo,
  GitCommitDetails,
  GitFileDiffResponse,
  GitHistoryEntry,
  GitHistoryResult,
  GitRebaseConflict,
  GitRebaseState,
  GitRepositoryState,
  GitStatusFile,
  GitStatusResponse,
  PullRequestDetail,
  PullRequestDiscovery,
  PullRequestFiles,
  PullRequestList,
  PullRequestRepository,
  PullRequestSummary,
} from '@prokopai/sdk';
import { mockIsoHoursAgo, mockIsoMinutesAgo, merge } from './mockHelpers';

export const MOCK_ROOT = '/home/user/my-project';

const HEAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const PARENT = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1';
const REMOTE_HEAD = 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';

// -----------------------------------------------------------------------------
// Repository and status
// -----------------------------------------------------------------------------

export function createGitRepository(overrides: Partial<GitRepositoryState> = {}): GitRepositoryState {
  return merge<GitRepositoryState>({
    branch: 'feature/login',
    head: HEAD,
    remotes: ['origin'],
    upstream: { remote: 'origin', branch: 'feature/login' },
  }, overrides);
}

export function createGitStatusFile(path: string, overrides: Partial<GitStatusFile['git']> = {}): GitStatusFile {
  return { path, git: { status: 'modified', staged: false, unstaged: true, additions: 12, deletions: 3, ...overrides } };
}

export function createGitStatus(overrides: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return merge<GitStatusResponse>({
    availability: { available: true },
    root: MOCK_ROOT,
    head: { oid: HEAD, branch: 'feature/login' },
    revision: 1,
    files: [
      createGitStatusFile('src/auth/session.ts', { additions: 24, deletions: 6 }),
      createGitStatusFile('src/auth/refresh.ts', { additions: 8, deletions: 1 }),
      createGitStatusFile('src/components/chat/MessageInput.tsx', { additions: 2, deletions: 2 }),
      createGitStatusFile('src/lib/newHelper.ts', { status: 'untracked', unstaged: true, additions: 40, deletions: 0 }),
      createGitStatusFile('src/lib/oldHelper.ts', { status: 'deleted', unstaged: true, additions: 0, deletions: 31 }),
      createGitStatusFile('docs/auth.md', { status: 'added', staged: true, unstaged: false, stagedAddition: true, additions: 15, deletions: 0 }),
      createGitStatusFile('package.json', { additions: 1, deletions: 1 }),
    ],
  }, overrides);
}

export const gitStatusPresets = {
  changes: createGitStatus(),
  clean: createGitStatus({ files: [] }),
  conflicted: createGitStatus({
    files: [
      createGitStatusFile('src/auth/session.ts', { status: 'conflicted', additions: 10, deletions: 10 }),
      createGitStatusFile('README.md', { additions: 3, deletions: 0 }),
    ],
  }),
  notARepo: createGitStatus({ availability: { available: false, reason: 'not_a_git_repo' }, files: [], head: undefined }),
  gitMissing: createGitStatus({ availability: { available: false, reason: 'git_not_installed' }, files: [], head: undefined }),
} as const;

// -----------------------------------------------------------------------------
// Branches and history
// -----------------------------------------------------------------------------

export function createBranch(overrides: Partial<GitBranchInfo> = {}): GitBranchInfo {
  const name = overrides.name ?? 'main';
  const kind = overrides.kind ?? 'local';
  return merge<GitBranchInfo>({
    ref: kind === 'local' ? `refs/heads/${name}` : `refs/remotes/${name}`,
    name,
    head: PARENT,
    kind,
    current: false,
    checkedOut: false,
    upstream: kind === 'local' ? `origin/${name}` : null,
    ahead: 0,
    behind: 0,
    committedAt: mockIsoHoursAgo(5),
  }, overrides);
}

export function createBranches(overrides: Partial<GitBranchesResult> = {}): GitBranchesResult {
  return merge<GitBranchesResult>({
    repository: createGitRepository(),
    lastFetchedAt: mockIsoMinutesAgo(12),
    branches: [
      createBranch({ name: 'feature/login', head: HEAD, current: true, checkedOut: true, ahead: 2, behind: 0, committedAt: mockIsoMinutesAgo(20) }),
      createBranch({ name: 'main', committedAt: mockIsoHoursAgo(3) }),
      createBranch({ name: 'fix/auth-flow', head: REMOTE_HEAD, checkedOut: true, ahead: 0, behind: 4, committedAt: mockIsoHoursAgo(26) }),
      createBranch({ name: 'feature/branches-panel', upstream: null, ahead: null, behind: null, committedAt: mockIsoHoursAgo(80) }),
      createBranch({ name: 'chore/deps', committedAt: mockIsoHoursAgo(200) }),
      createBranch({ name: 'origin/main', kind: 'remote', committedAt: mockIsoHoursAgo(3) }),
      createBranch({ name: 'origin/feature/login', kind: 'remote', head: PARENT, committedAt: mockIsoHoursAgo(1) }),
      createBranch({ name: 'origin/release/1.24', kind: 'remote', committedAt: mockIsoHoursAgo(50) }),
    ],
  }, overrides);
}

export function createHistoryEntry(index: number, overrides: Partial<GitHistoryEntry> = {}): GitHistoryEntry {
  const head = `${(index + 1).toString(16).padStart(2, '0')}${HEAD.slice(2)}`;
  return merge<GitHistoryEntry>({
    head,
    subject: [
      'auth: validate the exp claim before accepting a token',
      'client: keep the composer and title as they were, color the diff counts',
      'branches: read a commit one file at a time with a pinned header',
      'release: prepare server and client 1.24.0',
      'pull requests: one toolbar row on phones',
      'tests: bring stale client tests to current UI',
    ][index % 6],
    author: index % 3 === 0 ? 'Daniel' : 'Alice',
    date: mockIsoHoursAgo(index * 7 + 1),
    parents: [`${(index + 2).toString(16).padStart(2, '0')}${HEAD.slice(2)}`],
  }, overrides);
}

export function createHistory(count = 12, overrides: Partial<GitHistoryResult> = {}): GitHistoryResult {
  return merge<GitHistoryResult>({
    commits: Array.from({ length: count }, (_, i) => createHistoryEntry(i, i < 2 ? { sync: 'ahead' } : {})),
    nextOffset: null,
  }, overrides);
}

export const samplePatch = `diff --git a/src/auth/session.ts b/src/auth/session.ts
index 1111111..2222222 100644
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -40,7 +40,11 @@ export function verifyToken(token: string): Claims | null {
   const claims = decode(token);
   if (!claims) return null;
-  return claims;
+  if (typeof claims.exp !== 'number') return null;
+  if (claims.exp * 1000 < Date.now()) return null;
+  return claims;
 }
diff --git a/src/auth/session.test.ts b/src/auth/session.test.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/auth/session.test.ts
@@ -0,0 +1,6 @@
+import { verifyToken } from './session';
+
+test('rejects a token without exp', () => {
+  expect(verifyToken(sign({ sub: 'u1' }))).toBeNull();
+});
+
`;

export function createCommitDetails(overrides: Partial<GitCommitDetails> = {}): GitCommitDetails {
  return merge<GitCommitDetails>({
    files: ['src/auth/session.ts', 'src/auth/session.test.ts'],
    patch: samplePatch,
  }, overrides);
}

// -----------------------------------------------------------------------------
// Rebase
// -----------------------------------------------------------------------------

export const conflictedText = `export function verifyToken(token: string): Claims | null {
  const claims = decode(token);
  if (!claims) return null;
<<<<<<< HEAD
  if (typeof claims.exp !== 'number') return null;
  if (claims.exp * 1000 < Date.now()) return null;
=======
  if (!claims.exp || isExpired(claims.exp)) return null;
>>>>>>> feature: tighten token checks
  return claims;
}
`;

export function createRebaseState(overrides: Partial<GitRebaseState> = {}): GitRebaseState {
  return merge<GitRebaseState>({
    active: false,
    token: null,
    branch: null,
    originalHead: null,
    onto: null,
    conflicts: [],
  }, overrides);
}

export const rebasePresets = {
  idle: createRebaseState(),
  conflicts: createRebaseState({ active: true, token: 'rebase-token', branch: 'feature/login', originalHead: HEAD, onto: PARENT, conflicts: ['src/auth/session.ts', 'README.md'] }),
  resolved: createRebaseState({ active: true, token: 'rebase-token', branch: 'feature/login', originalHead: HEAD, onto: PARENT, conflicts: [] }),
} as const;

export function createRebaseConflict(overrides: Partial<GitRebaseConflict> = {}): GitRebaseConflict {
  return merge<GitRebaseConflict>({
    path: 'src/auth/session.ts',
    token: 'rebase-token',
    base: { text: conflictedText.replace(/<<<<<<<[\s\S]*?=======\n/, '').replace(/>>>>>>>.*\n/, ''), binary: false, mode: '100644' },
    feature: { text: conflictedText.replace(/=======[\s\S]*?>>>>>>>.*\n/, '').replace(/<<<<<<<.*\n/, ''), binary: false, mode: '100644' },
    original: null,
    workingText: conflictedText,
  }, overrides);
}

// -----------------------------------------------------------------------------
// Files
// -----------------------------------------------------------------------------

export const projectPaths = [
  '.gitignore',
  'README.md',
  'package.json',
  'bunfig.toml',
  'docs/',
  'docs/auth.md',
  'docs/getting-started.md',
  'docs/images/',
  'docs/images/logo.svg',
  'src/',
  'src/index.ts',
  'src/app.ts',
  'src/auth/',
  'src/auth/session.ts',
  'src/auth/refresh.ts',
  'src/auth/session.test.ts',
  'src/components/',
  'src/components/chat/',
  'src/components/chat/MessageInput.tsx',
  'src/components/chat/ChatView.tsx',
  'src/components/ui/',
  'src/components/ui/button.tsx',
  'src/lib/',
  'src/lib/newHelper.ts',
  'src/lib/utils.ts',
  'node_modules/',
  'dist/',
];

export function createFileTreeResponse(overrides: Partial<FileTreeResponse> = {}): FileTreeResponse {
  return merge<FileTreeResponse>({
    root: MOCK_ROOT,
    isMain: true,
    paths: projectPaths,
    ignored: ['node_modules/', 'dist/'],
    truncated: false,
    revision: 1,
  }, overrides);
}

const sampleCode = `import { decode } from './jwt';

export interface Claims {
  sub: string;
  exp?: number;
}

export function verifyToken(token: string): Claims | null {
  const claims = decode(token);
  if (!claims) return null;
  if (typeof claims.exp !== 'number') return null;
  if (claims.exp * 1000 < Date.now()) return null;
  return claims;
}
`;

const sampleMarkdown = `# Authentication

Tokens are verified in \`src/auth/session.ts\`.

![Logo](images/logo.svg)

- The \`exp\` claim is required.
- Refresh happens in \`refresh.ts\`.
`;

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="#6b7280"><rect x="4.9" y="4.9" width="11.9" height="2.5" rx="1.25"/><rect x="4.9" y="9.1" width="2.5" height="2.7" rx="1.25" opacity="0.45"/><rect x="8.6" y="9.1" width="10.6" height="2.7" rx="1.35" opacity="0.45"/><rect x="4.9" y="13.3" width="11.9" height="2.5" rx="1.25"/><rect x="4.9" y="17.5" width="2.5" height="2.5" rx="1.25"/></svg>`;

export const filePreviewPresets = {
  code: { path: 'src/auth/session.ts', name: 'session.ts', extension: 'ts', size: sampleCode.length, kind: 'code', readOnly: true, language: 'typescript', content: sampleCode },
  text: { path: '.gitignore', name: '.gitignore', size: 30, kind: 'text', readOnly: true, content: 'node_modules/\ndist/\n.env\n' },
  markdown: { path: 'docs/auth.md', name: 'auth.md', extension: 'md', size: sampleMarkdown.length, kind: 'markdown', readOnly: true, language: 'markdown', content: sampleMarkdown },
  image: { path: 'docs/images/logo.svg', name: 'logo.svg', extension: 'svg', size: logoSvg.length, kind: 'image', readOnly: true, mimeType: 'image/svg+xml', dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(logoSvg)}`, content: logoSvg },
  binary: { path: 'assets/sounds/done.mp3', name: 'done.mp3', extension: 'mp3', size: 48_211, kind: 'binary', readOnly: true, mimeType: 'audio/mpeg', reason: 'Binary file' },
  unsupported: { path: 'build/app.wasm', name: 'app.wasm', extension: 'wasm', size: 1_204_000, kind: 'unsupported', readOnly: true, reason: 'WebAssembly modules cannot be previewed' },
  tooLarge: { path: 'data/dump.sql', name: 'dump.sql', extension: 'sql', size: 52_000_000, kind: 'too_large', readOnly: true, reason: 'File is larger than the preview limit', maxBytes: 2_000_000 },
} as const satisfies Record<string, FilePreviewResponse>;

export function createEditableFile(overrides: Partial<EditableFileResponse> = {}): EditableFileResponse {
  return merge<EditableFileResponse>({
    path: 'src/auth/session.ts',
    name: 'session.ts',
    extension: 'ts',
    size: sampleCode.length,
    content: sampleCode,
    revision: 'rev-1',
    readOnly: false,
    language: 'typescript',
    encoding: 'utf-8',
  }, overrides);
}

export function createGitFileDiff(overrides: Partial<GitFileDiffResponse> = {}): GitFileDiffResponse {
  return merge<GitFileDiffResponse>({
    path: 'src/auth/session.ts',
    diffAvailable: true,
    status: { status: 'modified', staged: false, unstaged: true, additions: 2, deletions: 1 },
    additions: 2,
    deletions: 1,
    language: 'typescript',
    hunks: [{
      oldStart: 9,
      oldLines: 4,
      newStart: 9,
      newLines: 5,
      changes: [
        { type: 'context', content: '  const claims = decode(token);', lineNumber: 9, newLineNumber: 9 },
        { type: 'context', content: '  if (!claims) return null;', lineNumber: 10, newLineNumber: 10 },
        { type: 'removed', content: '  return claims;', lineNumber: 11 },
        { type: 'added', content: "  if (typeof claims.exp !== 'number') return null;", newLineNumber: 11 },
        { type: 'added', content: '  if (claims.exp * 1000 < Date.now()) return null;', newLineNumber: 12 },
        { type: 'context', content: '}', lineNumber: 12, newLineNumber: 13 },
      ],
    }],
  }, overrides);
}

// -----------------------------------------------------------------------------
// Pull requests
// -----------------------------------------------------------------------------

export function createPullRequestRepository(overrides: Partial<PullRequestRepository> = {}): PullRequestRepository {
  return merge<PullRequestRepository>({
    key: 'github:acme/app',
    remote: 'origin',
    provider: 'github',
    host: 'github.com',
    owner: 'acme',
    name: 'app',
    url: 'https://github.com/acme/app',
  }, overrides);
}

export function createPullRequestDiscovery(overrides: Partial<PullRequestDiscovery> = {}): PullRequestDiscovery {
  return merge<PullRequestDiscovery>({
    branch: 'feature/login',
    connections: [
      { repository: createPullRequestRepository(), status: 'connected', accountId: 'acct-1', accountName: 'daniel' },
    ],
  }, overrides);
}

export function createPullRequestSummary(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  const number = overrides.number ?? 7;
  return merge<PullRequestSummary>({
    number,
    title: 'auth: validate the exp claim before accepting a token',
    body: 'Tokens without an `exp` claim were accepted. This adds the check and a regression test.\n\n- [x] tests\n- [ ] changelog',
    url: `https://github.com/acme/app/pull/${number}`,
    author: { id: 'daniel', name: 'Daniel' },
    state: 'open',
    draft: false,
    sourceBranch: 'feature/login',
    targetBranch: 'main',
    head: HEAD,
    base: PARENT,
    updatedAt: mockIsoHoursAgo(2),
  }, overrides);
}

export function createPullRequestDetail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return merge<PullRequestDetail>({
    ...createPullRequestSummary(),
    accountId: 'acct-1',
    reviewers: [
      { id: 'alice', name: 'Alice', vote: 'approve' },
      { id: 'bob', name: 'Bob', vote: 'wait' },
    ],
    checks: [
      { name: 'build', state: 'success', url: 'https://github.com/acme/app/actions/runs/1' },
      { name: 'test', state: 'failure', url: 'https://github.com/acme/app/actions/runs/2', action: { kind: 'rerun', target: 'job-2' } },
      { name: 'lint', state: 'pending' },
    ],
    comments: [
      { id: 'c1', author: { id: 'alice', name: 'Alice' }, body: 'Looks good. One question about the refresh path below.', createdAt: mockIsoHoursAgo(3) },
    ],
    threads: [
      {
        id: 't1', path: 'src/auth/session.ts', line: 11, side: 'RIGHT', resolved: false, outdated: false, canResolve: true,
        comments: [{ id: 'c2', author: { id: 'alice', name: 'Alice' }, body: 'Should this also reject `exp` in the far future?', createdAt: mockIsoHoursAgo(3) }],
      },
      {
        id: 't2', path: 'src/auth/refresh.ts', line: 4, side: 'RIGHT', resolved: true, outdated: true, canResolve: true,
        comments: [{ id: 'c3', author: { id: 'bob', name: 'Bob' }, body: 'nit: rename to refreshSession', createdAt: mockIsoHoursAgo(20) }],
      },
    ],
    mergeability: 'mergeable',
    mergeMethods: ['squash', 'merge'],
    warnings: [],
  }, overrides);
}

export function createPullRequestList(count = 6, overrides: Partial<PullRequestList> = {}): PullRequestList {
  return merge<PullRequestList>({
    accountId: 'acct-1',
    nextPage: null,
    items: Array.from({ length: count }, (_, i) => createPullRequestSummary({
      number: 7 + i,
      title: [
        'auth: validate the exp claim before accepting a token',
        'client: quieter transcript and tool previews that peek instead of scroll',
        'branches: read a commit one file at a time with a pinned header',
        'release: prepare server and client 1.24.0',
        'pull requests: one toolbar row on phones, hide it while a PR is open',
        'tests: bring stale client tests to current UI',
      ][i % 6],
      draft: i === 1,
      state: i === 3 ? 'merged' : i === 5 ? 'closed' : 'open',
      author: i % 2 === 0 ? { id: 'daniel', name: 'Daniel' } : { id: 'alice', name: 'Alice' },
      sourceBranch: ['feature/login', 'client/quiet-transcript', 'branches/commit-files', 'release/1.24', 'pr/phone-toolbar', 'tests/stale'][i % 6],
      updatedAt: mockIsoHoursAgo(i * 5 + 1),
    })),
  }, overrides);
}

export function createPullRequestFiles(overrides: Partial<PullRequestFiles> = {}): PullRequestFiles {
  return merge<PullRequestFiles>({
    head: HEAD,
    nextPage: null,
    files: [
      { path: 'src/auth/session.ts', status: 'modified', additions: 3, deletions: 1 },
      { path: 'src/auth/session.test.ts', status: 'added', additions: 6, deletions: 0 },
      { path: 'docs/auth.md', status: 'modified', additions: 2, deletions: 0 },
      { path: 'src/lib/oldHelper.ts', status: 'removed', additions: 0, deletions: 31 },
    ],
  }, overrides);
}
