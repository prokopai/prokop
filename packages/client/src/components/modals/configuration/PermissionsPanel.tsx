import { useState } from 'react';
import { RefreshCw, Trash2, ShieldCheck, ShieldHalf, ShieldAlert } from 'lucide-react';
import type { PermissionGrant, PermissionMode } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { PageActions } from '@/components/views/settingsPageActions';
import { PermissionListItem } from '../PermissionListItem';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

const MODE_OPTIONS: { value: PermissionMode; label: string; icon: typeof ShieldCheck }[] = [
  { value: 'standard', label: 'Standard', icon: ShieldCheck },
  { value: 'extended', label: 'Extended', icon: ShieldHalf },
  { value: 'full', label: 'Full access', icon: ShieldAlert },
];

interface PermissionsPanelProps {
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  permissions: PermissionGrant[];
  onRefreshPermissions: () => void;
  onRevokePermission: (permissionId: string) => void;
  onRevokeAllPermissions: () => void;
}

export function PermissionsPanel({
  mode,
  onModeChange,
  permissions,
  onRefreshPermissions,
  onRevokePermission,
  onRevokeAllPermissions,
}: PermissionsPanelProps) {
  const [showRevokeAllConfirm, setShowRevokeAllConfirm] = useState(false);

  const activePermissions = permissions.filter((p) => !p.revokedAt);
  const revokedPermissions = permissions.filter((p) => p.revokedAt);

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      {/* Default mode applies immediately, like the default model. */}
      <SettingsGroup label="Mode">
        <SettingsRow label="Default for new sessions" description="Override per session with the shield in the chat header.">
          <Select value={mode} onValueChange={(v) => onModeChange(v as PermissionMode)}>
            <SelectTrigger className="w-40" aria-label="Default permission mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <SelectItem key={value} value={value}>
                  <Icon className="size-4" />
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <PageActions>
        <Button variant="ghost" size="icon" aria-label="Refresh permissions" onClick={onRefreshPermissions}>
          <RefreshCw />
        </Button>
        {activePermissions.length > 0 && (
          <Button variant="outline" onClick={() => setShowRevokeAllConfirm(true)}>
            <Trash2 data-icon="inline-start" />
            Revoke all
          </Button>
        )}
      </PageActions>
      <SettingsGroup label={`Saved permissions · ${activePermissions.length} active${revokedPermissions.length > 0 ? ` · ${revokedPermissions.length} revoked` : ''}`}
        description="Tool approvals saved for this workspace. Revoked ones need approval again when used.">
        {activePermissions.map((permission) => (
          <PermissionListItem key={permission.id} permission={permission} onRevoke={onRevokePermission} />
        ))}
        {revokedPermissions.map((permission) => (
          <PermissionListItem key={permission.id} permission={permission} onRevoke={onRevokePermission} />
        ))}
        {activePermissions.length === 0 && revokedPermissions.length === 0 && (
          <SettingsRow label={<span className="text-xs text-muted-foreground">No saved permissions yet. Saved permission grants will appear here after approval.</span>} />
        )}
      </SettingsGroup>

      <ConfirmationDialog
        open={showRevokeAllConfirm}
        onOpenChange={setShowRevokeAllConfirm}
        title="Revoke All Permissions"
        description="This will revoke all saved permissions for this workspace. The tools will need to be approved again when used."
        confirmLabel="Revoke All"
        variant="destructive"
        onConfirm={() => {
          onRevokeAllPermissions();
          setShowRevokeAllConfirm(false);
        }}
      />
    </div>
  );
}
