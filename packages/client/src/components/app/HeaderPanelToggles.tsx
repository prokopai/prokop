import { serverUpdateNotice } from '@/hooks/useServerUpdate';
import { PanelBottom, PanelLeft, PanelRight, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HeaderPanelTogglesProps {
  leftActive: boolean;
  onToggleLeft: () => void;
  rightActive: boolean;
  onToggleRight: () => void;
  bottomActive: boolean;
  onToggleBottom: () => void;
  /** The right dock holds repository views, which exist only with a workspace. */
  hasRightDock: boolean;
  mobile?: boolean;
  onOpenSettings: () => void;
  updateVersion?: string | null;
}

/**
 * Shell panel toggles and settings entry shared by the mobile and desktop
 * headers. Panels are one tap away on both layouts instead of being buried
 * in a collapsed menu on mobile.
 */
export function HeaderPanelToggles({
  leftActive,
  onToggleLeft,
  rightActive,
  onToggleRight,
  bottomActive,
  onToggleBottom,
  hasRightDock,
  mobile = false,
  onOpenSettings,
  updateVersion,
}: HeaderPanelTogglesProps) {
  const leftLabel = mobile ? 'Sessions' : 'left dock';
  const rightLabel = mobile ? 'Files' : 'right dock';
  const bottomLabel = mobile ? 'Terminal' : 'bottom dock';
  const leftTitle = `${leftActive ? 'Hide' : 'Show'} ${leftLabel}`;
  const rightTitle = `${rightActive ? 'Hide' : 'Show'} ${rightLabel}`;
  const bottomTitle = `${bottomActive ? 'Hide' : 'Show'} ${bottomLabel}`;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleLeft}
        aria-pressed={leftActive}
        aria-label={leftTitle}
        title={leftTitle}
        className={leftActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
      >
        <PanelLeft />
      </Button>
      {hasRightDock && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleRight}
          aria-pressed={rightActive}
          aria-label={rightTitle}
          title={rightTitle}
          className={rightActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
        >
          <PanelRight />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleBottom}
        aria-pressed={bottomActive}
        aria-label={bottomTitle}
        title={bottomTitle}
        className={bottomActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
      >
        <PanelBottom />
      </Button>
      <div className="mx-1 h-5 w-px bg-border/50" />
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={onOpenSettings}
        aria-label={updateVersion ? `Settings, ${serverUpdateNotice(updateVersion).title}` : 'Settings'}
        title={updateVersion ? `${serverUpdateNotice(updateVersion).title}. ${serverUpdateNotice(updateVersion).hint}` : 'Settings'}
      >
        <Settings className="size-4" />
        {updateVersion && (
          <span aria-hidden="true" data-update-available className="absolute right-1 top-1 size-1.5 rounded-full bg-highlight ring-2 ring-background" />
        )}
      </Button>
    </div>
  );
}
