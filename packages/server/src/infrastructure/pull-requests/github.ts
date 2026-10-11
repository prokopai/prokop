import type {
  PullRequestRepository,
  PullRequestSummary,
  PullRequestComment,
  PullRequestThread,
  PullRequestDetail,
  PullRequestFile,
  PullRequestPatch,
  PullRequestCheck,
} from '@prokopai/sdk/types';
import type { PullRequestProviderPort } from '@/application/ports/pull-requests';
import { BadRequestError, ConflictError } from '@/application/http-errors';
import { array, integer, object, required, str } from './cli';
import type { GitHubApi } from './github-rest';

const actor = (value: unknown) => {
  if (value === null) return { id: 'deleted', name: 'Deleted user' };
  const v = object(value);
  return { id: String(integer(v.id)), name: required(v.login) };
};
function summary(value: unknown): PullRequestSummary {
  const v = object(value);
  const head = object(v.head);
  const base = object(v.base);
  if (!['open', 'closed'].includes(str(v.state)) || typeof v.draft !== 'boolean')
    throw new BadRequestError('GitHub returned an invalid PR state.');
  return {
    number: integer(v.number),
    title: required(v.title),
    body: str(v.body),
    url: required(v.html_url),
    author: actor(v.user),
    state: v.merged_at || v.merged === true ? 'merged' : v.state === 'closed' ? 'closed' : 'open',
    draft: v.draft,
    sourceBranch: required(head.ref),
    targetBranch: required(base.ref),
    head: required(head.sha),
    base: required(base.sha),
    updatedAt: required(v.updated_at),
    requestedReviewerIds: array(v.requested_reviewers).map((r) => actor(r).id),
  };
}
/** GraphQL actors carry the REST numeric ID as `databaseId`; accounts compare by it. */
function graphActor(value: unknown) {
  if (value == null) return { id: 'deleted', name: 'Deleted user' };
  const v = object(value);
  const login = required(v.login);
  return {
    id: typeof v.databaseId === 'number' ? String(integer(v.databaseId)) : login,
    name: v.__typename === 'Bot' ? `${login}[bot]` : login,
  };
}
function graphComment(value: unknown): PullRequestComment {
  const v = object(value);
  return {
    id: String(integer(v.databaseId)),
    author: graphActor(v.author),
    body: str(v.body),
    createdAt: required(v.createdAt),
  };
}
const ACTOR = '__typename login ...on User{databaseId} ...on Bot{databaseId}';
const THREADS = `reviewThreads(first:100){pageInfo{hasNextPage} nodes{id path line diffSide isResolved isOutdated viewerCanResolve viewerCanUnresolve comments(first:100){pageInfo{hasNextPage} nodes{databaseId body createdAt author{${ACTOR}}}}}}`;
function parseThreads(value: unknown): { threads: PullRequestThread[]; truncated: boolean } {
  const connection = object(value);
  let truncated = object(connection.pageInfo).hasNextPage === true;
  const threads = array(connection.nodes).map((node) => {
    const v = object(node);
    const comments = object(v.comments);
    truncated ||= object(comments.pageInfo).hasNextPage === true;
    return {
      id: required(v.id),
      path: required(v.path),
      ...(typeof v.line === 'number' ? { line: integer(v.line) } : {}),
      side: v.diffSide === 'LEFT' ? ('LEFT' as const) : ('RIGHT' as const),
      resolved: v.isResolved === true,
      outdated: v.isOutdated === true,
      canResolve: v.isResolved ? v.viewerCanUnresolve === true : v.viewerCanResolve === true,
      comments: array(comments.nodes).map(graphComment),
    };
  });
  return { threads, truncated };
}
/**
 * Check runs carry what Prokop can start for them: Actions jobs know their workflow run, and a
 * job waiting on a protected environment names it. Workflows waiting for approval (forks,
 * first-time contributors) have no jobs yet, only a check suite.
 */
const CHECKS = `statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{__typename ...on CheckRun{databaseId name status conclusion permalink checkSuite{workflowRun{databaseId}} pendingDeploymentRequest{currentUserCanApprove environment{databaseId name}}} ...on StatusContext{context state targetUrl}}}} checkSuites(first:50){nodes{conclusion workflowRun{databaseId url workflow{name}}}}`;
const RERUNNABLE = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE'];
function checkRun(v: Record<string, unknown>): PullRequestCheck {
  const check: PullRequestCheck = {
    name: required(v.name),
    state: (str(v.conclusion) || required(v.status)).toLowerCase(),
    url: str(v.permalink),
  };
  const run = object(v.checkSuite ?? {}).workflowRun;
  if (run == null) return check;
  const runId = String(integer(object(run).databaseId));
  const request = v.pendingDeploymentRequest == null ? null : object(v.pendingDeploymentRequest);
  if (v.status === 'WAITING' && request?.currentUserCanApprove === true) {
    const environment = object(request.environment);
    return {
      ...check,
      action: {
        kind: 'review-deployment',
        target: runId,
        environments: [{ id: integer(environment.databaseId), name: required(environment.name) }],
      },
    };
  }
  if (v.status === 'COMPLETED' && RERUNNABLE.includes(str(v.conclusion)))
    return { ...check, action: { kind: 'rerun', target: String(integer(v.databaseId)) } };
  return check;
}
/** Everything the detail view shows, in one request instead of one per section. */
const DETAIL = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed pullRequest(number:$number){number title body url state isDraft headRefName baseRefName headRefOid baseRefOid updatedAt mergeable author{${ACTOR}} autoMergeRequest{enabledAt} reviewRequests(first:100){nodes{requestedReviewer{__typename ...on User{login databaseId}}}} comments(first:100){pageInfo{hasNextPage} nodes{databaseId body createdAt author{${ACTOR}}}} reviews(first:100){pageInfo{hasNextPage} nodes{databaseId state body submittedAt author{${ACTOR}}}} ${THREADS} commits(last:1){nodes{commit{oid ${CHECKS}}}}}}}`;
const SECTIONS: Record<string, string> = {
  comments: 'Comments',
  reviews: 'Reviews',
  reviewThreads: 'Inline conversations',
  commits: 'Checks',
  reviewRequests: 'Review requests',
  autoMergeRequest: 'Automatic merge status',
};
/** GitHub sends each file's patch with the changed-file list; keep it so opening a file needs no request. */
function filePatch(v: Record<string, unknown>, path: string): PullRequestPatch {
  if (!str(v.patch))
    return {
      patch: '',
      unavailable:
        'GitHub did not provide a text patch for this file. It may be binary, unchanged after rename, or too large.',
    };
  const oldPath = str(v.previous_filename) || path;
  const old = v.status === 'added' ? '/dev/null' : JSON.stringify(`a/${oldPath}`);
  const next = v.status === 'removed' ? '/dev/null' : JSON.stringify(`b/${path}`);
  return {
    patch: `diff --git ${JSON.stringify(`a/${oldPath}`)} ${JSON.stringify(`b/${path}`)}\n--- ${old}\n+++ ${next}\n${str(v.patch)}\n`,
  };
}
const PAGE = 30;
const repoPath = (owner: string, name: string) =>
  `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
/** REST path for a provider-reported `full_name`, the canonical name after renames or transfers. */
function canonicalPath(value: unknown): string {
  const parts = required(value).split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw new BadRequestError('GitHub returned an invalid repository name.');
  return repoPath(parts[0], parts[1]);
}

export function createGitHubPullRequests(api: GitHubApi, repo: PullRequestRepository): PullRequestProviderPort {
  const base = repoPath(repo.owner, repo.name);
  // GitHub answers writes to a renamed or transferred repository with a 307 that gh does not
  // follow (reads get a followed 301), so writes target the canonical name from a read first.
  const writeBase = async () => canonicalPath(object(await api(base)).full_name);
  const raw = (number: number) => api(`${base}/pulls/${number}`).then(object);
  const graph = async (query: string, variables: Record<string, unknown>) => {
    const response = object(await api('graphql', 'POST', { query, variables }));
    if (response.errors)
      throw new BadRequestError(
        'GitHub could not complete the review request. Check permissions and refresh.',
      );
    return object(response.data);
  };
  const threads = async (number: number) =>
    parseThreads(
      object(
        object(
          object(
            await graph(
              `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){${THREADS}}}}`,
              { owner: repo.owner, name: repo.name, number },
            ),
          ).repository,
        ).pullRequest,
      ).reviewThreads,
    );
  const file = (value: unknown): PullRequestFile => {
    const v = object(value);
    const path = required(v.filename);
    return {
      path,
      ...(v.previous_filename ? { oldPath: required(v.previous_filename) } : {}),
      status: required(v.status),
      additions: integer(v.additions),
      deletions: integer(v.deletions),
      diff: filePatch(v, path),
    };
  };
  const checked = async (number: number, head: string) => {
    const pr = await raw(number);
    if (required(object(pr.head).sha) !== head)
      throw new ConflictError('The PR changed. Refresh before continuing.');
    return pr;
  };
  return {
    async account() {
      const user = actor(await api('user'));
      return { id: user.id, name: user.name };
    },
    async list(state, page) {
      const values = array(
        await api(
          `${base}/pulls?state=${state === 'merged' ? 'closed' : state}&sort=updated&direction=desc&per_page=${PAGE}&page=${page}`,
        ),
      );
      const items = values.map(summary);
      return {
        items: state === 'merged' || state === 'closed' ? items.filter((p) => p.state === state) : items,
        nextPage: values.length === PAGE ? page + 1 : null,
      };
    },
    async summary(number) {
      return summary(await raw(number));
    },
    async detail(number) {
      const response = object(
        await api('graphql', 'POST', {
          query: DETAIL,
          variables: { owner: repo.owner, name: repo.name, number },
        }),
      );
      const repository = object(object(response.data ?? {}).repository ?? {});
      if (repository.pullRequest == null)
        throw new BadRequestError('GitHub could not load this pull request. Check permissions and refresh.');
      const pr = object(repository.pullRequest);
      // A section GitHub could not resolve comes back as null with an error naming its path.
      const warnings = new Set<string>();
      const unavailable = (label: string) => warnings.add(`${label} unavailable. Refresh or open on GitHub.`);
      for (const error of Array.isArray(response.errors) ? response.errors : []) {
        const path = error && typeof error === 'object' && Array.isArray(error.path) ? error.path : [];
        if (path[1] === 'pullRequest' && typeof path[2] === 'string' && SECTIONS[path[2]]) unavailable(SECTIONS[path[2]]);
        else if (path[1] !== 'pullRequest') unavailable('Merge methods');
        else unavailable('Some details');
      }
      const optional = <T>(label: string, read: () => T, fallback: T): T => {
        try {
          return read();
        } catch {
          unavailable(label);
          return fallback;
        }
      };
      if (!['OPEN', 'CLOSED', 'MERGED'].includes(str(pr.state)) || typeof pr.isDraft !== 'boolean')
        throw new BadRequestError('GitHub returned an invalid PR state.');
      const requested = optional(
        'Review requests',
        () =>
          array(object(pr.reviewRequests).nodes)
            .map((node) => object(node).requestedReviewer)
            // Team requests have no login; GitHub lists only users as requested reviewers.
            .filter((reviewer) => reviewer != null && typeof object(reviewer).login === 'string')
            .map(graphActor),
        [],
      );
      const result: PullRequestSummary = {
        number: integer(pr.number),
        title: required(pr.title),
        body: str(pr.body),
        url: required(pr.url),
        author: graphActor(pr.author),
        state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
        draft: pr.isDraft,
        sourceBranch: required(pr.headRefName),
        targetBranch: required(pr.baseRefName),
        head: required(pr.headRefOid),
        base: required(pr.baseRefOid),
        updatedAt: required(pr.updatedAt),
        requestedReviewerIds: requested.map((r) => r.id),
      };
      let truncated = false;
      const page = (value: unknown) => {
        const connection = object(value);
        truncated ||= object(connection.pageInfo).hasNextPage === true;
        return array(connection.nodes);
      };
      const comments = optional('Comments', () => page(pr.comments).map(graphComment), []);
      const reviews = optional('Reviews', () => page(pr.reviews).map(object), []);
      const reviewThreads = optional('Inline conversations', () => parseThreads(pr.reviewThreads), {
        threads: [],
        truncated: false,
      });
      truncated ||= reviewThreads.truncated;
      const checks = optional(
        'Checks',
        () => {
          const commit = object(object(array(object(pr.commits).nodes)[0]).commit);
          if (commit.oid !== result.head) throw new Error('Checks belong to another commit.');
          const waiting = array(object(commit.checkSuites ?? { nodes: [] }).nodes)
            .map(object)
            .filter((suite) => suite.conclusion === 'ACTION_REQUIRED' && suite.workflowRun != null)
            .map((suite): PullRequestCheck => {
              const run = object(suite.workflowRun);
              return {
                name: required(object(run.workflow).name),
                state: 'action_required',
                url: str(run.url),
                action: { kind: 'approve-run', target: String(integer(run.databaseId)) },
              };
            });
          if (commit.statusCheckRollup == null) return waiting;
          return [
            ...waiting,
            ...page(object(commit.statusCheckRollup).contexts).map((value): PullRequestCheck => {
              const v = object(value);
              return v.__typename === 'CheckRun'
                ? checkRun(v)
                : { name: required(v.context), state: required(v.state).toLowerCase(), url: str(v.targetUrl) };
            }),
          ];
        },
        [],
      );
      if (truncated) warnings.add('Some activity may be omitted. Open on GitHub for the full history.');
      const reviewers = new Map<string, PullRequestDetail['reviewers'][number]>();
      for (const review of reviews) {
        if (review.state === 'PENDING') continue;
        const user = graphActor(review.author);
        reviewers.set(user.id, { ...user, vote: required(review.state) });
        if (str(review.body))
          comments.push(graphComment({ ...review, createdAt: review.submittedAt }));
      }
      for (const user of requested) reviewers.set(user.id, { ...user, vote: 'Review requested' });
      comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        ...result,
        autoMerge: pr.autoMergeRequest != null,
        reviewers: [...reviewers.values()],
        comments,
        threads: reviewThreads.threads,
        warnings: [...warnings],
        checks,
        mergeability:
          pr.mergeable === 'MERGEABLE' ? 'mergeable' : pr.mergeable === 'CONFLICTING' ? 'conflicting' : 'unknown',
        mergeMethods: [
          ...(repository.mergeCommitAllowed === true ? ['merge' as const] : []),
          ...(repository.squashMergeAllowed === true ? ['squash' as const] : []),
          ...(repository.rebaseMergeAllowed === true ? ['rebase' as const] : []),
        ],
      };
    },
    async files(number, head, page) {
      const values = array(await api(`${base}/pulls/${number}/files?per_page=${PAGE}&page=${page}`));
      // Checking after the read is enough: a push before or during it changes the head.
      await checked(number, head);
      return {
        files: values.map(file),
        nextPage: values.length === PAGE && page < 100 ? page + 1 : null,
        truncated: values.length === PAGE && page === 100,
        head,
      };
    },
    async patch(number, head, path) {
      // GitHub only exposes patches through the paginated changed-file list.
      for (let page = 1; page <= 30; page++) {
        const values = array(await api(`${base}/pulls/${number}/files?per_page=100&page=${page}`));
        const found = values.map(object).find((v) => v.filename === path);
        if (found) {
          await checked(number, head);
          return filePatch(found, path);
        }
        if (values.length < 100) break;
      }
      throw new BadRequestError('File is not in the available PR diff.');
    },
    async create(input) {
      return summary(
        await api(`${await writeBase()}/pulls`, 'POST', {
          title: input.title,
          body: input.body,
          head: input.sourceBranch,
          base: input.targetBranch,
          draft: input.draft,
        }),
      );
    },
    async action(number, input) {
      const pr = await checked(number, input.expectedHead);
      const target = canonicalPath(object(object(pr.base).repo).full_name);
      switch (input.action) {
        case 'edit':
          await api(`${target}/pulls/${number}`, 'PATCH', { title: input.title, body: input.body });
          break;
        case 'close':
        case 'reopen':
          await api(`${target}/pulls/${number}`, 'PATCH', {
            state: input.action === 'close' ? 'closed' : 'open',
          });
          break;
        case 'ready':
        case 'draft': {
          const mutation =
            input.action === 'ready' ? 'markPullRequestReadyForReview' : 'convertPullRequestToDraft';
          await graph(`mutation($id:ID!){${mutation}(input:{pullRequestId:$id}){pullRequest{id}}}`, {
            id: required(pr.node_id),
          });
          break;
        }
        case 'merge': {
          if (input.method === 'rebase-merge')
            throw new BadRequestError('GitHub does not support this merge method.');
          const result = object(
            await api(`${target}/pulls/${number}/merge`, 'PUT', {
              sha: input.expectedHead,
              merge_method: input.method,
            }),
          );
          if (result.merged !== true)
            throw new ConflictError('GitHub did not merge the PR. Refresh its checks and merge status.');
          break;
        }
        case 'enable-auto-merge': {
          if (input.method === 'rebase-merge')
            throw new BadRequestError('GitHub does not support this merge method.');
          await graph(
            'mutation($id:ID!,$method:PullRequestMergeMethod!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$method}){pullRequest{id}}}',
            { id: required(pr.node_id), method: input.method.toUpperCase() },
          );
          break;
        }
        case 'disable-auto-merge':
          await graph(
            'mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){pullRequest{id}}}',
            { id: required(pr.node_id) },
          );
          break;
        case 'review': {
          const events = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' };
          if (!(input.verdict in events)) throw new BadRequestError('Unsupported GitHub review verdict.');
          await api(`${target}/pulls/${number}/reviews`, 'POST', {
            commit_id: input.expectedHead,
            body: input.body,
            event: events[input.verdict as keyof typeof events],
          });
          break;
        }
        case 'comment':
          if (input.position)
            await api(`${target}/pulls/${number}/comments`, 'POST', {
              body: input.body,
              commit_id: input.expectedHead,
              path: input.position.path,
              line: input.position.line,
              side: input.position.side,
            });
          else await api(`${target}/issues/${number}/comments`, 'POST', { body: input.body });
          break;
        case 'reviewer':
          await api(`${target}/pulls/${number}/requested_reviewers`, input.remove ? 'DELETE' : 'POST', {
            reviewers: [input.reviewer],
          });
          break;
        case 'reply':
        case 'resolve': {
          const thread = (await threads(number)).threads.find((t) => t.id === input.threadId);
          if (!thread) throw new BadRequestError('Conversation is not part of this pull request.');
          if (input.action === 'reply') {
            if (!thread.comments[0]) throw new BadRequestError('Conversation has no comment to reply to.');
            await api(`${target}/pulls/${number}/comments/${thread.comments[0].id}/replies`, 'POST', {
              body: input.body,
            });
          } else {
            const mutation = input.resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
            await graph(`mutation($id:ID!){${mutation}(input:{threadId:$id}){thread{id}}}`, {
              id: thread.id,
            });
          }
          break;
        }
        case 'check': {
          if (input.operation === 'queue') throw new BadRequestError('GitHub does not support this check action.');
          if (!/^\d+$/.test(input.target)) throw new BadRequestError('This check is not part of this pull request.');
          // Jobs and runs must belong to the reviewed commit, not just to the repository.
          const current = (value: unknown) => {
            if (required(object(value).head_sha) !== input.expectedHead)
              throw new ConflictError('This check belongs to another commit. Refresh before continuing.');
          };
          if (input.operation === 'rerun') {
            current(await api(`${target}/actions/jobs/${input.target}`));
            await api(`${target}/actions/jobs/${input.target}/rerun`, 'POST');
            break;
          }
          const run = `${target}/actions/runs/${input.target}`;
          current(await api(run));
          if (input.operation === 'approve-run') {
            await api(`${run}/approve`, 'POST');
            break;
          }
          const allowed = new Set(
            array(await api(`${run}/pending_deployments`))
              .map(object)
              .filter((pending) => pending.current_user_can_approve === true)
              .map((pending) => integer(object(pending.environment).id)),
          );
          const environments = input.environmentIds ?? [];
          if (!environments.length || environments.some((id) => !allowed.has(id)))
            throw new ConflictError('This deployment is no longer waiting for your review. Refresh before continuing.');
          await api(`${run}/pending_deployments`, 'POST', {
            environment_ids: environments,
            state: input.operation === 'approve-deployment' ? 'approved' : 'rejected',
            comment: '',
          });
          break;
        }
      }
    },
  };
}
