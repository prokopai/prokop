import { ErrorState, LoadingState } from '@/components/shared/States';
import { useState } from 'react';
import type { ProkopaiClient, ProviderCredentialStatus } from '@prokopai/sdk';
import { useProviderCredentialsQuery, useSetProviderCredential, useClearProviderCredential } from '@/hooks/queries';
import { Check, X, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
  embedded?: boolean;
  /** Render only this provider's credential row (used by provider cards). */
  provider?: string;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
  'zhipu-coding': 'Z.AI Coding',
};

function formatProviderName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider] || provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * API keys per provider. With `provider`, one row for that provider inside its
 * group; otherwise a group with one row per provider.
 */
export function ProviderCredentialsPanel({ sdkClient, embedded = false, provider: filter }: PanelProps) {
  const { data: credentialsData, isLoading: loading } = useProviderCredentialsQuery(sdkClient);
  const setCredentialMut = useSetProviderCredential(sdkClient);
  const clearCredentialMut = useClearProviderCredential(sdkClient);
  const providers: ProviderCredentialStatus[] = (credentialsData?.providers ?? [])
    .filter(cred => !filter || cred.provider === filter);
  const [error, setError] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleSetKey = async (provider: string) => {
    if (!apiKeyInput.trim()) return;
    setActionLoading(provider);
    try {
      await setCredentialMut.mutateAsync({ provider, body: { apiKey: apiKeyInput.trim() } });
      setEditingProvider(null);
      setApiKeyInput('');
      setShowKey(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set key');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearKey = async (provider: string) => {
    setActionLoading(provider);
    try {
      await clearCredentialMut.mutateAsync(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear key');
    } finally {
      setActionLoading(null);
    }
  };

  if (filter && providers.length === 0) {
    return null;
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error && providers.length === 0) {
    return <ErrorState className="m-3 sm:m-4">{error}</ErrorState>;
  }

  const rows = providers.map((cred) => {
    const busy = actionLoading === cred.provider;
    const control = editingProvider === cred.provider ? (
      <span className="flex items-center gap-1">
        <span className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="Enter API key…"
            aria-label={`${formatProviderName(cred.provider)} API key`}
            className="w-full pr-7 font-mono sm:w-56"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSetKey(cred.provider);
              if (e.key === 'Escape') {
                setEditingProvider(null);
                setApiKeyInput('');
              }
            }}
            autoFocus
          />
          <Button type="button" variant="ghost" size="icon-xs" className="absolute top-0.5 right-0.5" aria-label={showKey ? 'Hide key' : 'Show key'} onClick={() => setShowKey(!showKey)}>
            {showKey ? <EyeOff /> : <Eye />}
          </Button>
        </span>
        <Button size="icon" aria-label="Save key" onClick={() => handleSetKey(cred.provider)} disabled={!apiKeyInput.trim() || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Cancel" onClick={() => { setEditingProvider(null); setApiKeyInput(''); }}>
          <X />
        </Button>
      </span>
    ) : (
      <span className="flex items-center gap-1">
        <Button
          variant="outline"
          onClick={() => {
            setEditingProvider(cred.provider);
            setApiKeyInput('');
            setShowKey(false);
          }}
          disabled={busy}
        >
          {cred.configured ? 'Update' : 'Set Key'}
        </Button>
        {cred.configured && (
          <Button variant="ghost" size="icon" aria-label="Clear key" onClick={() => handleClearKey(cred.provider)} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        )}
      </span>
    );
    return (
      <SettingsRow
        key={cred.provider}
        className={filter ? 'pl-6' : undefined}
        label={filter ? 'API key' : (
          <span className="flex items-center gap-2">
            {formatProviderName(cred.provider)}
            <Badge variant={cred.configured ? 'secondary' : 'outline'}>{cred.configured ? 'Configured' : 'Not set'}</Badge>
          </span>
        )}
        description={filter ? (cred.configured ? 'Stored in ~/.prokopai/.env on the server.' : 'Needed before its models can run.') : undefined}
      >
        {control}
      </SettingsRow>
    );
  });

  if (filter) {
    return <>
      {rows}
      {error && <SettingsRow label={<span className="text-xs text-error">{error}</span>} />}
    </>;
  }

  return (
    <div className={embedded ? 'flex flex-col gap-4' : 'flex flex-col gap-4 p-3 sm:p-4'}>
      <SettingsGroup label="API keys" description="Stored in ~/.prokopai/.env on the server and never sent to the client.">
        {rows}
      </SettingsGroup>
      {error && <ErrorState>{error}</ErrorState>}
    </div>
  );
}
