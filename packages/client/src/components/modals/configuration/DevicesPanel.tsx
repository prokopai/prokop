import { useCallback, useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import type {
  AccessStatus,
  CreatePairingCodeResponse,
  PairedDevice,
  PendingAccessRequest,
  ProkopaiClient,
} from '@prokopai/sdk';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollectionRow, RowTile } from '@/components/ui/collection-row';
import { PageActions } from '@/components/views/settingsPageActions';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/States';
import { RemoteAccessSection } from './RemoteAccessSection';

interface DevicesPanelProps {
  sdkClient: ProkopaiClient | null;
}

function lastSeen(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function PairingCode({ pairing, onDone }: { pairing: CreatePairingCodeResponse; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, Math.max(0, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing.expiresAt, onDone]);

  const link = pairing.links[0];
  if (!link) {
    return (
      <SettingsRow label="Other devices can't reach Prokop yet." description="Turn on remote access above, then pair again.">
        <Button variant="ghost" onClick={onDone}>Done</Button>
      </SettingsRow>
    );
  }

  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(link, { border: 2 }))}`;
  return (
    <SettingsRow label="Scan with the other device" description={<>Code <span className="font-mono text-foreground">{pairing.code}</span> works once and expires in 5 minutes.</>} stacked>
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
        <img src={qr} alt="Pairing QR code" className="size-36 shrink-0 rounded-md bg-white p-1" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Or open one of these links there:</span>
          {pairing.links.map((item) => (
            <code key={item} className="block break-all font-mono text-xs">{item}</code>
          ))}
          <Button variant="ghost" size="xs" className="mt-1 self-start" onClick={onDone}>Done</Button>
        </div>
      </div>
    </SettingsRow>
  );
}

/**
 * Devices paired with this server. The server's own machine approves requests,
 * creates pairing codes, and revokes devices; a paired device can only unpair itself.
 */
export function DevicesPanel({ sdkClient }: DevicesPanelProps) {
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [requests, setRequests] = useState<PendingAccessRequest[]>([]);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairing, setPairing] = useState<CreatePairingCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sdkClient) return;
    try {
      const current = await sdkClient.http.access.status();
      setStatus(current);
      if (current.admin) {
        const overview = await sdkClient.http.access.overview();
        setRequests(overview.requests);
        setDevices(overview.devices);
      }
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [sdkClient]);

  useEffect(() => {
    void load();
    if (!sdkClient) return;
    const refresh = () => void load();
    // Pushed by the server whenever requests or devices change; no polling.
    sdkClient.on('access.changed', refresh);
    return () => { sdkClient.off('access.changed', refresh); };
  }, [sdkClient, load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const closePairing = useCallback(() => setPairing(null), []);

  if (!sdkClient) return <EmptyState variant="plain">Connect to a server to manage devices.</EmptyState>;
  if (!status) return error ? <ErrorState className="m-3 sm:m-4">{error}</ErrorState> : <LoadingState />;

  if (!status.admin) {
    return (
      <div className="flex flex-col gap-4 p-3 sm:p-4">
        <SettingsGroup label="This device" description="Devices are managed on the computer running Prokop.">
          <SettingsRow label={status.device ? `Paired as ${status.device.label}` : 'Paired'}>
            {status.device && (
              <Button variant="outline" disabled={busy !== null}
                onClick={() => void run('self', () => sdkClient.http.access.revokeDevice(status.device!.id))}>
                Unpair this device
              </Button>
            )}
          </SettingsRow>
        </SettingsGroup>
        {error && <ErrorState>{error}</ErrorState>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <RemoteAccessSection sdkClient={sdkClient} />

      <PageActions>
        <Button disabled={busy !== null || pairing !== null}
          onClick={() => void run('pair', async () => setPairing(await sdkClient.http.access.createPairingCode()))}>
          Pair a device
        </Button>
      </PageActions>
      {pairing && (
        <SettingsGroup label="Pairing">
          <PairingCode pairing={pairing} onDone={closePairing} />
        </SettingsGroup>
      )}

      {requests.length > 0 && (
        <SettingsGroup label="Waiting for approval">
          {requests.map((request) => (
            <SettingsRow key={request.id} label={request.label}
              description={<span title="Should match the code on the other device">Code <span className="font-mono text-foreground">{request.matchCode}</span></span>}>
              <span className="flex items-center gap-1">
                <Button variant="outline" disabled={busy !== null}
                  onClick={() => void run(request.id, () => sdkClient.http.access.approve(request.id))}>Allow</Button>
                <Button variant="ghost" disabled={busy !== null}
                  onClick={() => void run(request.id, () => sdkClient.http.access.deny(request.id))}>Deny</Button>
              </span>
            </SettingsRow>
          ))}
        </SettingsGroup>
      )}

      <SettingsGroup label="Paired devices" description="Use Prokop from your phone or another computer. This computer never needs to pair.">
        {devices.length === 0 ? (
          <SettingsRow label={<span className="text-muted-foreground">No other devices are paired.</span>} />
        ) : devices.map((device) => (
          <CollectionRow key={device.id} icon={<RowTile><Smartphone /></RowTile>} title={device.label} status={`Last seen ${lastSeen(device.lastSeenAt)}`}
            actions={
              <Button variant="ghost" size="xs" disabled={busy !== null} className="opacity-0 transition-opacity group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100 pointer-coarse:opacity-100"
                onClick={() => void run(device.id, () => sdkClient.http.access.revokeDevice(device.id))}>Remove</Button>
            } />
        ))}
      </SettingsGroup>
      {error && <ErrorState>{error}</ErrorState>}
    </div>
  );
}
