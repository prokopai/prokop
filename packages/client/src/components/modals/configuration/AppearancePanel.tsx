import { SegmentedControl } from '@/components/ui/segmented-control';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Sun, Moon, Monitor, Eye, Pencil, CornerDownRight, Clock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/components/providers/ThemeProvider';
import type { ThemeMode, ThemeScheme } from '@/components/providers/ThemeProvider';
import { useUIStore } from '@/stores/uiStore';
import type { DefaultFileOpenMode, FollowUpMode } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { WorkspaceOrderControl } from '@/components/layout/WorkspaceOrderControl';

const SCHEMES: ThemeScheme[] = ['neutral', 'ocean', 'forest', 'sunset', 'amethyst'];

/**
 * Scheme preview rendered from the real token cascade: the wrapper carries
 * the scheme class plus both mode classes, so children resolve the exact
 * tokens the app would use. Index.css pairs them as `.light.<scheme>` and
 * `.dark.<scheme>`.
 */
function SchemeButton({ scheme, currentScheme, onClick }: {
  scheme: ThemeScheme;
  currentScheme: ThemeScheme;
  onClick: (scheme: ThemeScheme) => void;
}) {
  const isSelected = scheme === currentScheme;

  return (
    <button
      type="button"
      onClick={() => onClick(scheme)}
      aria-pressed={isSelected}
      title={scheme}
      className={cn(
        'flex flex-col items-center gap-1 rounded-md border p-1.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        isSelected
          ? 'border-highlight bg-highlight/5'
          : 'border-border/50 bg-transparent hover:bg-muted/50',
      )}
    >
      {/* Light mode preview: card on background with primary chip */}
      <div className={cn('light', scheme, 'flex w-full flex-col gap-1 rounded-sm border bg-background p-1')}>
        <div className="flex items-center justify-between gap-1">
          <div className="h-1 w-6 rounded-full bg-primary" />
          <div className="size-2.5 rounded-full bg-card ring-1 ring-border" />
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="h-1 w-4 rounded-full bg-accent" />
          <div className="size-2.5 rounded-full bg-primary/20" />
        </div>
      </div>
      {/* Dark mode preview: same structure from the dark tokens */}
      <div className={cn('dark', scheme, 'flex w-full flex-col gap-1 rounded-sm border bg-background p-1')}>
        <div className="flex items-center justify-between gap-1">
          <div className="h-1 w-6 rounded-full bg-primary" />
          <div className="size-2.5 rounded-full bg-card ring-1 ring-border" />
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="h-1 w-4 rounded-full bg-accent" />
          <div className="size-2.5 rounded-full bg-primary/20" />
        </div>
      </div>
      <span className="text-2xs text-muted-foreground capitalize">{scheme}</span>
    </button>
  );
}

const MODES: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

const OPEN_MODES: { value: DefaultFileOpenMode; icon: typeof Eye; label: string }[] = [
  { value: 'preview', icon: Eye, label: 'Preview files' },
  { value: 'edit', icon: Pencil, label: 'Edit files' },
];

const FOLLOW_UP_MODES: { value: FollowUpMode; icon: typeof Sun; label: string }[] = [
  { value: 'steer', icon: CornerDownRight, label: 'Steer' },
  { value: 'queue', icon: Clock, label: 'Queue' },
];

export function AppearancePanel() {
  const { mode, scheme, setMode, setScheme } = useTheme();
  const { defaultFileOpenMode, setDefaultFileOpenMode, followUpMode, setFollowUpMode } = useUIStore(
    useShallow((s) => ({
      defaultFileOpenMode: s.defaultFileOpenMode,
      setDefaultFileOpenMode: s.setDefaultFileOpenMode,
      followUpMode: s.followUpMode,
      setFollowUpMode: s.setFollowUpMode,
    })),
  );

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <SettingsGroup label="Theme">
        <SettingsRow label="Mode">
          <SegmentedControl label="Theme mode" options={MODES} value={mode} onChange={setMode} />
        </SettingsRow>
        <SettingsRow label="Color scheme" stacked>
          <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-5">
            {SCHEMES.map((s) => (
              <SchemeButton key={s} scheme={s} currentScheme={scheme} onClick={setScheme} />
            ))}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Workspaces" description="On this device, across servers. Recently active follows the latest message, not opening a session.">
        <SettingsRow label="Order" htmlFor="workspace-order">
          <WorkspaceOrderControl />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Files" description="Right-click always offers both.">
        <SettingsRow label="Click opens">
          <SegmentedControl label="File open mode" options={OPEN_MODES} value={defaultFileOpenMode} onChange={setDefaultFileOpenMode} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Chat" description="Steer joins the running turn at its next step. Queue sends after the turn ends.">
        <SettingsRow label="Message while the agent works">
          <SegmentedControl label="Messages sent while the agent works" options={FOLLOW_UP_MODES} value={followUpMode} onChange={setFollowUpMode} />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
