import type { ProkopaiClient } from '@prokopai/sdk';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import LogoutButton from '@/components/LogoutButton';
import { VersionInfo } from '@/components/VersionInfo';

interface SystemPanelProps {
  apiToken: string | null;
  isConnected: boolean;
  onLogout: () => void;
  sdkClient: ProkopaiClient | null;
  open: boolean;
}

export function SystemPanel({ apiToken, isConnected, onLogout, sdkClient, open }: SystemPanelProps) {
  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <SettingsGroup label="Connection">
        {isConnected ? (
          <LogoutButton token={apiToken} onLogout={onLogout} />
        ) : (
          <SettingsRow label="Not connected" description="No active session." />
        )}
      </SettingsGroup>

      <VersionInfo sdkClient={sdkClient} enabled={open} />
    </div>
  );
}
