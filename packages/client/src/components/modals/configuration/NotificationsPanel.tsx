import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Switch } from '@/components/ui/switch';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { NotificationSettings } from './NotificationSettings';

export function NotificationsPanel() {
  const {
    chatFinishSoundEnabled,
    setChatFinishSoundEnabled,
    permissionSoundEnabled,
    setPermissionSoundEnabled,
  } = useUIStore(
    useShallow((s) => ({
      chatFinishSoundEnabled: s.chatFinishSoundEnabled,
      setChatFinishSoundEnabled: s.setChatFinishSoundEnabled,
      permissionSoundEnabled: s.permissionSoundEnabled,
      setPermissionSoundEnabled: s.setPermissionSoundEnabled,
    })),
  );

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <SettingsGroup label="Sounds" description="Played in this app when something needs you.">
        <SettingsRow label="Chat completion" htmlFor="sound-chat-completion">
          <Switch
            id="sound-chat-completion"
            checked={chatFinishSoundEnabled}
            onCheckedChange={setChatFinishSoundEnabled}
            aria-label="Chat completion sound"
          />
        </SettingsRow>
        <SettingsRow label="Approvals and questions" htmlFor="sound-permission">
          <Switch
            id="sound-permission"
            checked={permissionSoundEnabled}
            onCheckedChange={setPermissionSoundEnabled}
            aria-label="Approval and question sound"
          />
        </SettingsRow>
      </SettingsGroup>

      <NotificationSettings />
    </div>
  );
}
