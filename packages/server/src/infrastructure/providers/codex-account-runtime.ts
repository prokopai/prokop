import type { OAuthTokenSet } from '@/domains/provider-accounts/oauth';
import { applyCodexRefresh, OAuthTokenRefreshError } from '@/domains/provider-accounts/oauth';
import type { CodexAccount, CodexAccountStore } from './codex-accounts';
import { createCodexFetch, type CodexCredentials } from '@prokopai/core/infrastructure/providers/codex-access';

/** Pins credentials to a local account, including refresh and 401 retries. */
export class CodexAccountRuntime {
  private readonly refreshing = new Map<string, Promise<CodexAccount>>();

  constructor(
    private readonly store: CodexAccountStore,
    private readonly refresh: (token: string) => Promise<OAuthTokenSet>,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  private async credentials(id: string, rejectedRevision?: string): Promise<CodexAccount> {
    const account = this.store.get(id);
    if (!account || account.reauthRequired) throw new Error('Codex account requires connection in Settings.');
    if (account.config.expires > Date.now() && account.revision !== rejectedRevision) return account;
    const key = `${account.id}:${account.revision}`;
    const existing = this.refreshing.get(key);
    if (existing) return existing;
    const pending = this.refreshAccount(account);
    this.refreshing.set(key, pending);
    try {
      return await pending;
    } finally {
      this.refreshing.delete(key);
    }
  }

  private async refreshAccount(account: CodexAccount): Promise<CodexAccount> {
    let tokens: OAuthTokenSet;
    try {
      tokens = await this.refresh(account.config.refresh);
    } catch (error: unknown) {
      if (error instanceof OAuthTokenRefreshError && (error.code === 'invalid_grant' || error.status === 401)) {
        this.store.updateCredentials(account, account.config, true);
      }
      // Transient failures must not erase credentials or switch subscriptions.
      throw error;
    }
    const config = applyCodexRefresh({ ...account.config }, tokens, Date.now());
    if (config.accountId !== account.config.accountId) {
      this.store.updateCredentials(account, account.config, true);
      throw new Error('Codex refresh changed account identity. Reconnect this account in Settings.');
    }
    const saved = this.store.updateCredentials(account, config);
    if (!saved || saved.reauthRequired || saved.connectionId !== account.connectionId) {
      throw new Error('Codex account changed while refreshing. Retry the request.');
    }
    return saved;
  }

  /**
   * Credentials of the account (`undefined`: the selected one), refreshed when
   * expired or when `rejectedRevision` was rejected. Served to the agent
   * process as `provider.codexCredentials`; the host keeps the tokens.
   */
  async credentialsFor(accountId?: string, rejectedRevision?: string): Promise<CodexCredentials> {
    const selected = this.store.get(accountId);
    if (!selected) throw new Error('Codex not connected. Select an account in Settings > LLM providers.');
    const account = await this.credentials(selected.id, rejectedRevision);
    return {
      id: account.id, connectionId: account.connectionId, revision: account.revision, access: account.config.access,
      ...(account.config.accountId ? { accountId: account.config.accountId } : {}),
    };
  }

  async createFetch(accountId?: string): Promise<typeof globalThis.fetch> {
    return createCodexFetch({ credentials: (id, rejected) => this.credentialsFor(id, rejected) }, accountId, this.fetch);
  }

}
