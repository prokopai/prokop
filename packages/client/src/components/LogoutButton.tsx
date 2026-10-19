import { maskToken } from '@/config/auth';
import { Button } from '@/components/ui/button';
import { SettingsRow } from '@/components/ui/settings-row';

interface LogoutButtonProps {
  token?: string | null;
  onLogout: () => void;
}

/** The connection row of the System page: who this client is to the server, and the way out. */
export default function LogoutButton({ token, onLogout }: LogoutButtonProps) {
  // Paired devices hold a `pkd_` token; anything else is the shared PROKOPAI_AUTH_TOKEN.
  const label = token ? (token.startsWith('pkd_') ? 'Paired device' : 'Shared token') : 'This computer';
  return (
    <SettingsRow
      label={label}
      description={token ? <code className="font-mono text-2xs">{maskToken(token)}</code> : 'No token needed on the machine running Prokop.'}
    >
      <Button variant="destructive" onClick={onLogout} title="Disconnect and clear token">
        Log out
      </Button>
    </SettingsRow>
  );
}
