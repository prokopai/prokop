import { useCallback, useEffect, useState } from 'react';
import type { ProkopaiClient, RemoteAccessKind, RemoteAccessStatus } from '@prokopai/sdk';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Switch } from '@/components/ui/switch';
import { ErrorState } from '@/components/shared/States';

const KIND_LABELS: Record<RemoteAccessKind, string> = {
  lan: 'Wi-Fi / LAN',
  tailscale: 'Tailscale',
  vpn: 'VPN',
  proxy: 'Proxy',
};

interface RemoteAccessSectionProps {
  sdkClient: ProkopaiClient;
}

/**
 * How other devices reach this server: listen on the network, publish an
 * address (VPN, proxy, tunnel), or share over Tailscale HTTPS.
 */
export function RemoteAccessSection({ sdkClient }: RemoteAccessSectionProps) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await sdkClient.http.remoteAccess.status());
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [sdkClient]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    sdkClient.on('access.changed', refresh);
    return () => { sdkClient.off('access.changed', refresh); };
  }, [sdkClient, load]);

  const run = async (action: () => Promise<RemoteAccessStatus>) => {
    setBusy(true);
    try {
      setStatus(await action());
      setError(null);
      return true;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!status) return error ? <ErrorState>{error}</ErrorState> : null;

  const tailscaleShared = status.tailscale.serving
    && status.addresses.some((item) => item.url === status.tailscale.url);
  const showAddresses = status.addresses.length > 0 || (status.listenOnNetwork && status.suggestions.length > 0);

  return (
    <>
      <SettingsGroup label="Remote access" description="How your phone and other devices reach Prokop. They still have to be paired.">
        <SettingsRow
          label="Allow devices on my network"
          htmlFor="remote-access-network"
          description={status.bindLockedByEnvironment
            ? `Set by PROKOPAI_HOST (${status.bindHost}).`
            : 'Wi-Fi, LAN, and VPNs such as Tailscale or WireGuard.'}
        >
          <Switch
            id="remote-access-network"
            checked={status.listenOnNetwork}
            disabled={busy || status.bindLockedByEnvironment}
            onCheckedChange={(checked) => void run(() => sdkClient.http.remoteAccess.setListenOnNetwork(checked))}
            aria-label="Allow devices on my network"
          />
        </SettingsRow>

        {status.tailscale.installed && (
          <SettingsRow
            label="Tailscale HTTPS"
            description={!status.tailscale.running ? 'Tailscale is not connected on this computer.'
              : tailscaleShared ? `Shared at ${status.tailscale.url}`
                : `Share at ${status.tailscale.url} with a trusted certificate.`}
          >
            <Button variant={tailscaleShared ? 'ghost' : 'outline'} disabled={busy || !status.tailscale.running}
              onClick={() => void run(() => sdkClient.http.remoteAccess.setTailscale(!tailscaleShared))}>
              {tailscaleShared ? 'Stop' : 'Set up'}
            </Button>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup label="Addresses">
        {showAddresses && status.addresses.map((item) => (
          <SettingsRow key={item.url} label={<code className="truncate font-mono text-xs">{item.url}</code>}>
            <span className="flex items-center gap-2">
              <Badge variant="secondary">{KIND_LABELS[item.kind]}</Badge>
              {item.source === 'saved' ? (
                <Button variant="ghost" size="xs" disabled={busy}
                  onClick={() => void run(() => sdkClient.http.remoteAccess.removeAddress(item.url))}>Remove</Button>
              ) : (
                <span className="text-xs text-muted-foreground" title="Set by PROKOPAI_ALLOWED_HOSTS">env</span>
              )}
            </span>
          </SettingsRow>
        ))}
        {showAddresses && status.listenOnNetwork && status.suggestions.map((item) => (
          <SettingsRow key={item.url} label={<code className="truncate font-mono text-xs text-muted-foreground">{item.url}</code>}>
            <Badge variant="outline">{KIND_LABELS[item.kind]}</Badge>
          </SettingsRow>
        ))}
        <SettingsRow label="Add an address" htmlFor="remote-access-address" description="A VPN, proxy or tunnel address other devices can open.">
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              if (!address.trim()) return;
              void run(() => sdkClient.http.remoteAccess.addAddress(address)).then((ok) => { if (ok) setAddress(''); });
            }}
          >
            <Input id="remote-access-address" value={address} onChange={(event) => setAddress(event.target.value)} disabled={busy}
              placeholder="https://prokop.example.com" aria-label="Address other devices use" className="sm:w-72" />
            <Button type="submit" variant="outline" disabled={busy || !address.trim()}>Add</Button>
          </form>
        </SettingsRow>
      </SettingsGroup>

      {error && <ErrorState>{error}</ErrorState>}
    </>
  );
}
