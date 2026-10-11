import { homedir } from 'node:os';
import { BadRequestError, ConflictError } from '@/application/http-errors';
import { json, providerMessage, type RunCli } from './cli';
import type { FetchLike } from './azure-rest';

const MAX_BYTES = 8 * 1024 * 1024;
/** `gh auth switch` and `gh auth login` take effect within this window. */
const TOKEN_TTL = 10_000;
const IDENTITY_TTL = 10 * 60_000;
const SIGN_IN = 'Sign in on the Prokop server with gh auth login.';

export interface GitHubCredentials {
  /** The token `gh` itself would use for github.com. */
  token(): Promise<string>;
  /** Drop the cached token after GitHub rejects it. */
  invalidate(): void;
  /** One `GET user` per token: a token always belongs to the same account. */
  identity(token: string, load: () => Promise<unknown>): Promise<unknown>;
}

/**
 * Reuse the gh sign-in without spawning gh for every request: read its token once,
 * then call the REST and GraphQL APIs directly over a kept-alive connection.
 */
export function createGitHubCredentials(run: RunCli, now: () => number = Date.now): GitHubCredentials {
  let cached: { value: Promise<string>; expires: number } | null = null;
  let identity: { token: string; value: Promise<unknown>; expires: number } | null = null;
  return {
    token() {
      if (cached && cached.expires > now()) return cached.value;
      const value = run({
        command: 'gh',
        cwd: homedir(),
        args: ['auth', 'token', '--hostname', 'github.com'],
        classify: (stderr) => (/no oauth token|not logged|gh auth login/i.test(stderr) ? SIGN_IN : undefined),
      }).then((text) => {
        const token = text.trim();
        if (!token || /\s/.test(token)) throw new BadRequestError(SIGN_IN);
        return token;
      });
      const entry = { value, expires: now() + TOKEN_TTL };
      cached = entry;
      // A failed sign-in must not stick; the next request runs gh again.
      value.catch(() => {
        if (cached === entry) cached = null;
      });
      return value;
    },
    invalidate() {
      cached = null;
      identity = null;
    },
    identity(token, load) {
      if (identity?.token === token && identity.expires > now()) return identity.value;
      const value = load();
      const entry = { token, value, expires: now() + IDENTITY_TTL };
      identity = entry;
      value.catch(() => {
        if (identity === entry) identity = null;
      });
      return value;
    },
  };
}

/** `(path, method, body)` below https://api.github.com/, for example `repos/o/r/pulls` or `graphql`. */
export type GitHubApi = (path: string, method?: string, body?: unknown) => Promise<unknown>;

export function githubRest(fetcher: FetchLike, credentials: GitHubCredentials): GitHubApi {
  const request = async (token: string, path: string, method: string, body: unknown): Promise<unknown> => {
    let response: Response;
    let text: string;
    try {
      response = await fetcher(`https://api.github.com/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'Prokop',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (Number(response.headers.get('content-length')) > MAX_BYTES)
        throw new BadRequestError('Provider response exceeded the size limit. Open this request on GitHub.');
      text = await response.text();
    } catch (error: unknown) {
      if (error instanceof BadRequestError) throw error;
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
        throw new BadRequestError(
          'GitHub timed out. Refresh the PR before retrying; the remote action may have completed.',
        );
      throw new BadRequestError('Could not reach GitHub from the Prokop server.');
    }
    if (text.length > MAX_BYTES)
      throw new BadRequestError('Provider response exceeded the size limit. Open this request on GitHub.');
    const status = response.status;
    if (status === 401) {
      credentials.invalidate();
      throw new BadRequestError(SIGN_IN);
    }
    if (status === 429 || (status === 403 && response.headers.get('x-ratelimit-remaining') === '0'))
      throw new BadRequestError('Provider rate limit reached. Wait before refreshing.');
    if (status >= 400) {
      const detail = providerMessage(text);
      if (status === 409) throw new ConflictError(detail || 'The PR changed. Refresh before continuing.');
      throw new BadRequestError(
        detail ||
          (status === 403
            ? 'The provider refused this operation. Check your permissions and repository policies.'
            : status === 404
              ? 'GitHub could not find this resource, or you do not have access to it.'
              : `GitHub request failed (HTTP ${status}). Refresh before retrying a write.`),
      );
    }
    return text.trim() ? json(text) : null;
  };
  return async (path, method = 'GET', body) => {
    const token = await credentials.token();
    if (path === 'user' && method === 'GET')
      return credentials.identity(token, () => request(token, path, method, body));
    return request(token, path, method, body);
  };
}
