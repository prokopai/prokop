import { Input } from '@/components/ui/input';
import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Unplug, Copy, Check, ClipboardPaste, RefreshCw } from 'lucide-react';
import type { ProkopaiClient, ProviderAccountStatus } from '@prokopai/sdk';
import { useProvidersQuery, useConnectProvider, useDisconnectProvider, useCompleteOAuth, useProviderAccountMutation } from '@/hooks/queries';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/States';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
  embedded?: boolean;
  /** Render only this provider's rows (used by provider cards). */
  provider?: string;
}

interface PendingAuth {
  providerId: string;
  flowId: string;
  redirectUri: string;
  authorizationUrl: string;
  previousConnections: string[];
}

function connectionIds(provider?: ProviderAccountStatus): string[] {
  return provider?.accounts?.map(account => account.connectionId)
    ?? (provider?.connectedAt ? [provider.connectedAt] : []);
}

/**
 * Subscription providers connected through OAuth. With `provider`, the rows
 * for that provider inside its group; otherwise a group per provider.
 */
export function OAuthProvidersPanel({ sdkClient, embedded = false, provider: filter }: PanelProps) {
  const { data: providersData, isLoading: loading, isFetching, refetch } = useProvidersQuery(sdkClient);
  const connectMut = useConnectProvider(sdkClient);
  const disconnectMut = useDisconnectProvider(sdkClient);
  const completeMut = useCompleteOAuth(sdkClient);
  const accountsMut = useProviderAccountMutation(sdkClient);
  const providers: ProviderAccountStatus[] = (providersData?.providers ?? [])
    .filter(provider => !filter || provider.provider === filter);
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);
  const [copiedAuth, setCopiedAuth] = useState(false);
  const [pasteUrl, setPasteUrl] = useState('');
  const [completing, setCompleting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleConnect = useCallback(async (providerId: string) => {
    setConnectingId(providerId);
    setPendingAuth(null);
    setError(null);
    const previousConnections = connectionIds(providers.find(provider => provider.provider === providerId));
    try {
      const data = await connectMut.mutateAsync({ providerId });
      if (data.authorizationUrl && data.flowId) {
        setPendingAuth({
          providerId,
          flowId: data.flowId,
          redirectUri: data.redirectUri || '',
          authorizationUrl: data.authorizationUrl,
          previousConnections,
        });
        // The browser cannot listen on localhost for the redirect, so the
        // flow completes by pasting the redirect URL below.
        window.open(data.authorizationUrl, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect provider');
    } finally {
      setConnectingId(null);
    }
  }, [connectMut, providers]);

  const handlePasteSubmit = useCallback(async () => {
    if (!pendingAuth || !pasteUrl.trim()) return;

    setCompleting(true);
    setError(null);
    try {
      let code: string;
      let state: string;

      // The paste can be the full URL, a query string, or just the code.
      const trimmed = pasteUrl.trim();
      try {
        const parsed = new URL(trimmed);
        code = parsed.searchParams.get('code') || '';
        state = parsed.searchParams.get('state') || '';
      } catch {
        if (trimmed.includes('code=')) {
          const params = new URLSearchParams(trimmed.startsWith('?') ? trimmed : `?${trimmed}`);
          code = params.get('code') || '';
          state = params.get('state') || '';
        } else {
          code = trimmed;
          state = '';
        }
      }

      if (!code) {
        setError('Could not extract authorization code from the pasted URL');
        return;
      }

      const result = await completeMut.mutateAsync({
        flowId: pendingAuth.flowId,
        code,
        state,
        redirectUri: pendingAuth.redirectUri,
      });

      if (result.success) {
        setPendingAuth(null);
        setPasteUrl('');
      } else {
        setError(result.error || 'OAuth completion failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete OAuth');
    } finally {
      setCompleting(false);
    }
  }, [pendingAuth, pasteUrl, completeMut]);

  const handleCopyAuthUrl = useCallback(async () => {
    if (!pendingAuth) return;
    try {
      await navigator.clipboard.writeText(pendingAuth.authorizationUrl);
      setCopiedAuth(true);
      setTimeout(() => setCopiedAuth(false), 2000);
    } catch {
      // silently fail
    }
  }, [pendingAuth]);

  const handleDisconnect = useCallback(async (providerId: string) => {
    setError(null);
    try {
      await disconnectMut.mutateAsync(providerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect provider');
    }
  }, [disconnectMut]);

  const handleAccountAction = async (providerId: string, accountId: string, action: 'activate' | 'remove') => {
    setError(null);
    try {
      await accountsMut.mutateAsync({ providerId, accountId, action });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update account');
    }
  };

  const handleRefresh = useCallback(async () => {
    setError(null);
    try {
      const result = await refetch({ throwOnError: true });
      if (result.error) {
        throw result.error;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh providers');
    }
  }, [refetch]);

  useEffect(() => {
    if (!pendingAuth || completing) return;
    const provider = providers.find((p) => p.provider === pendingAuth.providerId);
    const newConnection = connectionIds(provider).some(id => !pendingAuth.previousConnections.includes(id));
    if (provider && (newConnection || (!provider.accounts && provider.connected && pendingAuth.previousConnections.length === 0))) {
      toast.success(`${provider.displayName || provider.provider} connected`);
      setPendingAuth(null);
      setPasteUrl('');
      setError(null);
    }
  }, [pendingAuth, completing, providers]);

  if (filter && providers.length === 0) {
    return null;
  }

  if (loading) {
    return <LoadingState />;
  }

  const rowsFor = (provider: ProviderAccountStatus) => {
    const indent = filter ? 'pl-6' : undefined;
    const connecting = connectingId === provider.provider;
    const pending = pendingAuth?.providerId === provider.provider;
    return (
      <>
        {!filter && (
          <SettingsRow
            label={provider.displayName || provider.provider}
            description={provider.connected && provider.connectedAt ? `Connected ${new Date(provider.connectedAt).toLocaleDateString()}` : undefined}
          >
            {provider.reauthRequired ? (
              <span className="text-xs text-warning">Reauthentication required</span>
            ) : provider.connected ? (
              <span className="text-xs text-muted-foreground">Connected</span>
            ) : null}
          </SettingsRow>
        )}

        {provider.error && (
          <SettingsRow className={indent} label={<span className={`text-xs ${provider.reauthRequired ? 'text-warning' : 'text-error'}`}>{provider.error}</span>} />
        )}

        {provider.accounts && (
          <SettingsRow
            className={indent}
            label="Account"
            description={provider.accounts.length > 0 ? 'Used for new Codex runs on this server. Switch before sending your next message.' : undefined}
          >
            <span className="flex flex-wrap items-center justify-end gap-1">
              {provider.accounts.length > 0 && (
                <Select
                  value={provider.activeAccountId ?? ''}
                  onValueChange={id => void handleAccountAction(provider.provider, id, 'activate')}
                  disabled={!sdkClient || accountsMut.isPending}
                >
                  <SelectTrigger aria-label="Active Codex account" className="w-full min-w-0 sm:w-auto sm:max-w-72">
                    <SelectValue placeholder="Select an account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {provider.accounts.map((account, index) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.label}
                          {provider.accounts!.filter(a => a.label === account.label).length > 1 ? ` (${index + 1})` : ''}
                          {account.reauthRequired ? ' (reconnect)' : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline"
                onClick={() => handleConnect(provider.provider)}
                disabled={!sdkClient || connectingId !== null || pendingAuth !== null || accountsMut.isPending}
              >
                {connecting && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {provider.reauthRequired ? 'Reconnect account' : 'Add account'}
              </Button>
              {provider.activeAccountId && (
                <Button variant="ghost"
                  onClick={() => void handleAccountAction(provider.provider, provider.activeAccountId!, 'remove')}
                  disabled={!sdkClient || accountsMut.isPending || pendingAuth !== null}
                  aria-label="Remove active Codex account"
                >
                  Remove
                </Button>
              )}
            </span>
          </SettingsRow>
        )}

        {!provider.accounts && !pending && (
          <SettingsRow className={indent} label="Connection" description="Signs in with the subscription in a new tab.">
            <span className="flex items-center gap-1">
              {!provider.connected && !provider.reauthRequired && (
                <Button variant="outline" onClick={() => handleConnect(provider.provider)} disabled={connecting}>
                  {connecting && <Loader2 className="animate-spin" data-icon="inline-start" />}
                  Connect
                </Button>
              )}
              {provider.reauthRequired && (
                <>
                  <Button variant="outline" onClick={() => handleConnect(provider.provider)} disabled={connecting}>
                    {connecting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                    Reconnect
                  </Button>
                  <Button variant="ghost" onClick={() => handleDisconnect(provider.provider)}>
                    <Unplug data-icon="inline-start" />
                    Disconnect
                  </Button>
                </>
              )}
              {provider.connected && (
                <Button variant="destructive" onClick={() => handleDisconnect(provider.provider)}>
                  <Unplug data-icon="inline-start" />
                  Disconnect
                </Button>
              )}
            </span>
          </SettingsRow>
        )}

        {pending && pendingAuth && (
          <>
            <SettingsRow
              className={indent}
              label="Sign in"
              description="Open this URL to authenticate. To add a different account, use a private window or switch accounts on the sign-in page."
              stacked
            >
              <div className="flex w-full flex-col gap-2">
                <a
                  href={pendingAuth.authorizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs underline underline-offset-4"
                >
                  {pendingAuth.authorizationUrl}
                </a>
                <span className="flex items-center gap-1">
                  <Button variant="outline" size="xs" onClick={handleCopyAuthUrl}>
                    {copiedAuth ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                    {copiedAuth ? 'Copied' : 'Copy URL'}
                  </Button>
                  <Button variant="ghost" size="xs" disabled={completing} onClick={() => { setPendingAuth(null); setPasteUrl(''); }}>
                    Cancel
                  </Button>
                </span>
              </div>
            </SettingsRow>
            <SettingsRow className={indent} label="Redirect URL" description="After authenticating, paste the URL the browser lands on." htmlFor={`oauth-redirect-${provider.provider}`}>
              <span className="flex w-full items-center gap-1 sm:w-auto">
                <Input
                  id={`oauth-redirect-${provider.provider}`}
                  type="text"
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  placeholder="http://localhost:1455/oauth/…/callback?code=…"
                  className="font-mono text-xs sm:w-72 md:text-xs"
                />
                <Button onClick={handlePasteSubmit} disabled={!pasteUrl.trim() || completing}>
                  {completing ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ClipboardPaste data-icon="inline-start" />}
                  Submit
                </Button>
              </span>
            </SettingsRow>
          </>
        )}
      </>
    );
  };

  if (filter) {
    return <>
      {providers.map((provider) => <div key={provider.provider} className="contents">{rowsFor(provider)}</div>)}
      {error && <SettingsRow className="pl-6" label={<span className="text-xs text-error">{error}</span>} />}
    </>;
  }

  return (
    <div className={embedded ? 'flex flex-col gap-4' : 'flex flex-col gap-4 p-3 sm:p-4'}>
      <SettingsGroup description="Subscription providers sign in with OAuth. No API keys needed.">
        <SettingsRow label="Accounts">
          <Button variant="outline" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'animate-spin' : ''} data-icon="inline-start" />
            Refresh
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {error && <ErrorState>{error}</ErrorState>}

      {providers.length === 0 ? (
        <EmptyState variant="plain">No OAuth providers available.</EmptyState>
      ) : providers.map((provider) => (
        <SettingsGroup key={provider.provider}>{rowsFor(provider)}</SettingsGroup>
      ))}
    </div>
  );
}
