import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Skeleton } from '@/components/ui/skeleton';
import { CLIENT_VERSION } from '@/version';
import { checkUpdate, type UpdateStatus } from '@/utils/version';
import {
  fetchLatestServerVersion,
  fetchLatestClientVersion,
  clearVersionCache,
} from '@/utils/githubVersion';

interface VersionInfoProps {
  sdkClient: ProkopaiClient | null;
  enabled: boolean;
}

interface VersionState {
  serverVersion: string | null;
  latestServer: string | null;
  latestClient: string | null;
  loading: boolean;
  lastChecked: number | null;
  fetchError: string | null;
}

function formatLastChecked(timestamp: number | null): string {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function StatusBadge({ status }: { status: UpdateStatus }) {
  if (status === 'up-to-date') {
    return (
      <span className="flex items-center gap-1 text-xs text-success">
        <span className="inline-block size-1.5 rounded-full bg-success" />
        Up to date
      </span>
    );
  }
  if (status === 'update-available') {
    return <Badge variant="secondary" className="text-warning">Update available</Badge>;
  }
  return <span className="text-xs text-muted-foreground">Unknown</span>;
}

/** A version value with its status, or a placeholder while the check runs. */
function VersionValue({ loading, version, status, fallback }: { loading: boolean; version: string | null; status?: UpdateStatus; fallback: string }) {
  if (loading) return <Skeleton className="h-4 w-32" />;
  if (!version) return <span className="text-sm text-muted-foreground">{fallback}</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground tabular-nums">v{version}</span>
      {status && <StatusBadge status={status} />}
    </span>
  );
}

export function VersionInfo({ sdkClient, enabled }: VersionInfoProps) {
  const fetchIdRef = useRef(0);

  const [state, setState] = useState<VersionState>({
    serverVersion: null,
    latestServer: null,
    latestClient: null,
    loading: true,
    lastChecked: null,
    fetchError: null,
  });

  const fetchVersions = useCallback(async (force = false) => {
    if (force) clearVersionCache();

    const currentFetchId = ++fetchIdRef.current;
    setState(prev => ({ ...prev, loading: true, fetchError: null }));

    try {
      const results = await Promise.allSettled([
        sdkClient
          ? sdkClient.httpClient.get<{ version: string }>('/info').then(data => data.version).catch(() => null)
          : Promise.resolve(null),
        fetchLatestServerVersion(),
        fetchLatestClientVersion(),
      ]);

      if (fetchIdRef.current !== currentFetchId) return;

      const serverVersion = results[0].status === 'fulfilled' ? results[0].value : null;
      const latestServer = results[1].status === 'fulfilled' ? results[1].value : null;
      const latestClient = results[2].status === 'fulfilled' ? results[2].value : null;

      setState({
        serverVersion,
        latestServer,
        latestClient,
        loading: false,
        lastChecked: Date.now(),
        fetchError: null,
      });
    } catch {
      if (fetchIdRef.current !== currentFetchId) return;
      setState(prev => ({ ...prev, loading: false, fetchError: 'Unable to check for updates' }));
    }
  }, [sdkClient]);

  useEffect(() => {
    if (!enabled) return;
    fetchVersions();
  }, [fetchVersions, enabled]);

  const clientStatus = checkUpdate(CLIENT_VERSION, state.latestClient);
  const serverStatus = sdkClient && state.serverVersion
    ? checkUpdate(state.serverVersion, state.latestServer)
    : 'unknown';
  const latest = [
    state.latestServer ? `v${state.latestServer} (server)` : null,
    state.latestClient ? `v${state.latestClient} (client)` : null,
  ].filter(Boolean).join(' · ');

  return (
    <SettingsGroup label="Versions">
      <SettingsRow label="Client">
        <VersionValue loading={state.loading} version={CLIENT_VERSION} status={clientStatus} fallback="Unknown" />
      </SettingsRow>
      <SettingsRow label="Server">
        <VersionValue loading={state.loading} version={state.serverVersion} status={serverStatus} fallback="Not connected" />
      </SettingsRow>
      <SettingsRow label="Latest">
        {state.loading
          ? <Skeleton className="h-4 w-48" />
          : <span className="text-sm text-muted-foreground tabular-nums">{latest || 'Unknown'}</span>}
      </SettingsRow>
      <SettingsRow
        label="Updates"
        description={state.fetchError ?? (state.lastChecked && !state.loading ? `Checked ${formatLastChecked(state.lastChecked)}` : undefined)}
      >
        <Button variant="outline" onClick={() => fetchVersions(true)} disabled={state.loading}>
          <RefreshCw className={`size-3.5 ${state.loading ? 'animate-spin' : ''}`} />
          Check for updates
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}
