/**
 * Codex (ChatGPT) OAuth provider.
 * Uses the generalized OAuth manager for PKCE + authorization code flow.
 */
import type { ProviderStatus } from '@prokopai/sdk';
import { codexProviderDescriptor } from '@prokopai/core/infrastructure/providers/codex-access';
import { registerProvider } from '@prokopai/core/infrastructure/providers/registry';
import type { ConnectableProvider, TokenResponse } from '@prokopai/core/infrastructure/providers/types';
import { codexAccounts } from './codex-accounts';
import { CodexAccountRuntime } from './codex-account-runtime';
import {
  registerOAuthConfig,
  initiateOAuthFlow,
  refreshTokens,
} from '@/infrastructure/oauth/oauth-manager';

// Register Codex OAuth config with the generalized manager
registerOAuthConfig('codex', {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  scopes: 'openid profile email offline_access',
  redirectUri: 'http://localhost:1455/auth/callback',
  extraAuthParams: {
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'jean2',
  },
});

export const codexAccountRuntime = new CodexAccountRuntime(codexAccounts, token => refreshTokens('codex', token));

const codexProvider: ConnectableProvider = {
  descriptor: codexProviderDescriptor,

  getStatus(): ProviderStatus {
    return codexAccounts.status();
  },

  async connect(options) {
    const result = await initiateOAuthFlow('codex', options?.redirectStrategy);
    return {
      authorizationUrl: result.authorizationUrl,
      flowId: result.flowId,
      redirectStrategy: result.redirectStrategy,
      redirectUri: result.redirectUri,
    };
  },

  async disconnect() {
    codexAccounts.disconnect();
  },

  async onTokensReceived(tokens: TokenResponse): Promise<void> {
    codexAccounts.add(tokens);
  },

  // The model (and the AI SDK) loads on first use.
  async createModel(options) {
    const { createCodexModel } = await import('@prokopai/core/infrastructure/providers/codex-model');
    return createCodexModel(options, {
      credentials: (accountId, rejected) => codexAccountRuntime.credentialsFor(accountId, rejected),
    });
  },
};

registerProvider(codexProvider);
