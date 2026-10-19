import { ErrorState } from '@/components/shared/States';
import { useMemo } from 'react';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Switch } from '@/components/ui/switch';
import { useServerUrl } from '@/contexts/ServerClientContext';
import { useNotifications } from '@/hooks/useNotifications';
import { getSavedServers } from '@/config/servers';
import type { NotificationSupport } from '@/notifications/notificationSupport';

const SUPPORT_MESSAGES: Record<NotificationSupport, string> = {
  supported: '',
  unsupported: 'System notifications are not supported in this browser.',
  'insecure-context': 'System notifications require HTTPS.',
  'ios-install-required':
    'Add Prokopai to your Home Screen, then enable notifications from the installed app.',
};

/**
 * System push notifications for this device: one switch to enrol, then a
 * switch per kind. The browser decides support and permission; when it says
 * no, the row explains why and has no control.
 */
export function NotificationSettings() {
  const serverUrl = useServerUrl();

  const serverInfo = useMemo(() => {
    if (!serverUrl) return null;
    const server = getSavedServers().find(
      (s) => s.url === serverUrl,
    );
    if (!server) return null;
    return {
      serverId: server.id,
      serverName: server.name,
      serverUrl: server.url,
    };
  }, [serverUrl]);

  const {
    support,
    registrationState,
    permission,
    registration,
    error,
    notifyCompletion,
    notifyPermission,
    enable,
    disable,
    updatePrefs,
  } = useNotifications(serverInfo);

  // Don't render anything on unsupported platforms
  if (support === 'unsupported') {
    return null;
  }

  const isEnabling = registrationState === 'enabling';
  const isEnabled = registrationState === 'enabled';
  const isDenied = registrationState === 'denied' || permission === 'denied';
  const failed = registrationState === 'error' && !!error;

  const blocked = support !== 'supported'
    ? SUPPORT_MESSAGES[support]
    : isDenied
      ? 'Permission was denied. Re-enable it in your browser or system settings.'
      : null;

  return (
    <SettingsGroup label="System notifications">
      {blocked ? (
        <SettingsRow label="Push notifications" description={blocked} />
      ) : (
        <SettingsRow
          label="Push notifications"
          htmlFor="push-notifications"
          description={isEnabled
            ? `Enabled for ${registration?.serverName ?? 'this server'}`
            : isEnabling ? 'Enabling…' : undefined}
        >
          <Switch
            id="push-notifications"
            checked={isEnabled || isEnabling}
            disabled={isEnabling}
            onCheckedChange={(checked) => void (checked ? enable() : disable())}
            aria-label="System push notifications"
          />
        </SettingsRow>
      )}

      {failed && (
        <div className="px-3 py-2">
          <ErrorState onRetry={() => void enable()} retryLabel={isEnabling ? 'Enabling…' : 'Enable again'}>{error}</ErrorState>
        </div>
      )}

      {isEnabled && (
        <>
          <SettingsRow label="Session completion" htmlFor="push-completion">
            <Switch
              id="push-completion"
              checked={notifyCompletion}
              onCheckedChange={() => void updatePrefs({
                completion: !notifyCompletion,
                permission: notifyPermission,
              })}
              aria-label="Session completion notification"
            />
          </SettingsRow>
          <SettingsRow label="Approvals and questions" htmlFor="push-permission">
            <Switch
              id="push-permission"
              checked={notifyPermission}
              onCheckedChange={() => void updatePrefs({
                completion: notifyCompletion,
                permission: !notifyPermission,
              })}
              aria-label="Approval and question notification"
            />
          </SettingsRow>
        </>
      )}
    </SettingsGroup>
  );
}
