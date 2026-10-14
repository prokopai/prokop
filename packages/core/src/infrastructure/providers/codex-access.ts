import type { ProviderDescriptor } from '@prokopai/sdk/types';

/**
 * Codex subscription access (ChatGPT account via OAuth), the part both sides
 * share. The host owns accounts, OAuth and token refresh; whoever runs the
 * model (the host in process, or the agent process) sends requests with
 * credentials from a `CodexCredentialSource`. No AI SDK here.
 */

export const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
export const CODEX_OAUTH_DUMMY_KEY = 'codex-oauth-dummy-key';

export const codexProviderDescriptor: ProviderDescriptor = {
  id: 'codex',
  displayName: 'ChatGPT (Codex)',
  description: 'Use ChatGPT subscription models via OAuth',
  authType: 'oauth',
  connectable: true,
  providerOptionsKey: 'openai',
};

export interface CodexCredentials {
  id: string;
  connectionId: string;
  revision: string;
  access: string;
  /** ChatGPT account (workspace) header value. */
  accountId?: string;
}

export interface CodexCredentialSource {
  /**
   * Current credentials of the account (`undefined`: the selected one),
   * refreshed when expired or when `rejectedRevision` was just rejected.
   */
  credentials(accountId?: string, rejectedRevision?: string): Promise<CodexCredentials>;
}

/** A fetch pinned to one Codex account: Codex endpoints, bearer and account headers, one refresh on 401. */
export async function createCodexFetch(
  source: CodexCredentialSource,
  accountId?: string,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<typeof globalThis.fetch> {
  const selected = await source.credentials(accountId);
  const codexFetch = async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const current = await source.credentials(selected.id);
    signal?.throwIfAborted();
    if (current.connectionId !== selected.connectionId) throw new Error('Codex account reconnected. Retry the request.');
    const request = input instanceof Request ? input : undefined;
    const parsed = new URL(request ? request.url : String(input));
    const isCodexEndpoint = parsed.pathname.includes('/v1/responses') || parsed.pathname.includes('/chat/completions');
    const url = isCodexEndpoint ? new URL(CODEX_API_ENDPOINT) : parsed;
    const requestInit = request ? {
      method: request.method,
      body: request.body ? await request.clone().arrayBuffer() : undefined,
      signal: request.signal,
      redirect: request.redirect,
    } : {};
    const send = (credentials: CodexCredentials) => {
      const headers = new Headers(init?.headers ?? request?.headers);
      headers.set('authorization', `Bearer ${credentials.access}`);
      headers.delete('ChatGPT-Account-Id');
      if (credentials.accountId) headers.set('ChatGPT-Account-Id', credentials.accountId);
      headers.set('originator', 'jean2');
      return baseFetch(url, { ...requestInit, ...init, headers });
    };
    const response = await send(current);
    if (response.status !== 401 || signal?.aborted) return response;
    await response.body?.cancel();
    const refreshed = await source.credentials(selected.id, current.revision);
    signal?.throwIfAborted();
    if (refreshed.connectionId !== selected.connectionId) throw new Error('Codex account reconnected. Retry the request.');
    return send(refreshed);
  };
  return Object.assign(codexFetch, { preconnect: baseFetch.preconnect });
}
