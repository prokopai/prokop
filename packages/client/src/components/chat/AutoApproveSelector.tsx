import { ChevronDown, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import { useCallback } from 'react';
import { Chip, ChipLabel } from '@/components/ui/chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PermissionMode } from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionById } from '@/contexts/HostScopeContext';

interface AutoApproveSelectorProps {
  sessionId: string;
  sdkClient: ProkopaiClient | null;
  disabled?: boolean;
}

interface ModeConfig {
  icon: typeof ShieldCheck;
  iconClass: string;
  label: string;
  ariaLabel: string;
}

const MODE_CONFIGS: Record<PermissionMode, ModeConfig> = {
  standard: {
    icon: ShieldCheck,
    iconClass: 'text-success',
    label: 'Standard',
    ariaLabel: 'Standard permissions',
  },
  extended: {
    icon: ShieldHalf,
    iconClass: 'text-warning',
    label: 'Extended',
    ariaLabel: 'Extended permissions',
  },
  full: {
    icon: ShieldAlert,
    iconClass: 'text-error',
    label: 'Full access',
    ariaLabel: 'Full access permissions',
  },
};

const MODE_ORDER: PermissionMode[] = ['standard', 'extended', 'full'];

function getMenuItemIconClass(mode: PermissionMode): string {
  switch (mode) {
    case 'standard': return 'text-success';
    case 'extended': return 'text-warning';
    case 'full': return 'text-error';
  }
}

export interface PermissionModeChipProps {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}

/** The permission shield itself: shows a mode, offers the others. Where the mode lives is the caller's business. */
export function PermissionModeChip({ mode, onChange, disabled }: PermissionModeChipProps) {
  const config = MODE_CONFIGS[mode];
  const Icon = config.icon;

  if (disabled) {
    return (
      <Chip disabled aria-label={config.ariaLabel} title={config.label}>
        <Icon className={config.iconClass} />
        <ChipLabel>{config.label}</ChipLabel>
      </Chip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip aria-label={config.ariaLabel} title={config.label}>
          <Icon className={config.iconClass} />
          <ChipLabel>{config.label}<ChevronDown className="size-3 opacity-60" /></ChipLabel>
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {MODE_ORDER.map((option) => {
          const optionConfig = MODE_CONFIGS[option];
          const OptionIcon = optionConfig.icon;
          return (
            <DropdownMenuItem
              key={option}
              onClick={() => onChange(option)}
              className={option === mode ? 'bg-accent' : ''}
            >
              <OptionIcon className={`size-4 ${getMenuItemIconClass(option)}`} />
              <span>{optionConfig.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The shield for one session: the mode is the session's, saved through the SDK. */
export function AutoApproveSelector({
  sessionId,
  sdkClient,
  disabled,
}: AutoApproveSelectorProps) {
  const updateSession = useSessionStore((s) => s.updateSession);
  const session = useSessionById(sessionId);
  const currentMode: PermissionMode = session?.permissionMode ?? 'standard';

  const handleModeChange = useCallback(async (mode: PermissionMode) => {
    if (!sdkClient) return;

    try {
      const result = await sdkClient.http.sessions.update(sessionId, {
        permissionMode: mode,
      });

      updateSession(result.session);
    } catch (err) {
      console.error('Failed to update permission mode:', err);
    }
  }, [sdkClient, sessionId, updateSession]);

  return <PermissionModeChip mode={currentMode} onChange={(mode) => void handleModeChange(mode)} disabled={disabled} />;
}
