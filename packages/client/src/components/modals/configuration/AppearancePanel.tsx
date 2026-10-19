import { SegmentedControl } from '@/components/ui/segmented-control';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Sun, Moon, Monitor, Eye, Pencil, CornerDownRight, Clock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { ACCENT_LABELS, SURFACE_LABELS, THEME_SCHEMES, THEME_SURFACES, surfaceClass, useTheme } from '@/components/providers/ThemeProvider';
import type { ThemeMode } from '@/components/providers/ThemeProvider';
import { useUIStore } from '@/stores/uiStore';
import type { DefaultFileOpenMode, FollowUpMode } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { WorkspaceOrderControl } from '@/components/layout/WorkspaceOrderControl';

/**
 * A swatch button rendered from the real token cascade: each swatch carries
 * a theme class plus a mode class, so it resolves the exact color the app
 * would use. Index.css pairs them as `.light.<class>` and `.dark.<class>`.
 */
function SwatchButton({ label, themeClass, swatchClass, selected, onClick }: {
  label: string;
  /** The accent or surface class; null for the graphite base. */
  themeClass: string | null;
  /** What the swatch shows: the highlight for an accent, the sidebar for a surface. */
  swatchClass: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        selected
          ? 'border-highlight bg-highlight/5 text-foreground'
          : 'border-border/50 bg-transparent text-muted-foreground hover:bg-muted/50',
      )}
    >
      <span className="flex shrink-0 -space-x-1">
        <span className={cn('light', themeClass, 'size-3.5 rounded-full ring-1 ring-foreground/20', swatchClass)} />
        <span className={cn('dark', themeClass, 'size-3.5 rounded-full ring-1 ring-foreground/20', swatchClass)} />
      </span>
      {label}
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
  const { mode, scheme, surface, setMode, setScheme, setSurface } = useTheme();
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
        <SettingsRow label="Surface" description="The tone of panels and text. Graphite is neutral; the others add a hint of hue, Carbon is darker." stacked>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Surface">
            {THEME_SURFACES.map((s) => (
              <SwatchButton key={s} label={SURFACE_LABELS[s]} themeClass={surfaceClass(s)} swatchClass="bg-sidebar"
                selected={s === surface} onClick={() => setSurface(s)} />
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="Accent" description="Selection, attention cues and the window tint." stacked>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Accent">
            {THEME_SCHEMES.map((s) => (
              <SwatchButton key={s} label={ACCENT_LABELS[s]} themeClass={s} swatchClass="bg-highlight"
                selected={s === scheme} onClick={() => setScheme(s)} />
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
