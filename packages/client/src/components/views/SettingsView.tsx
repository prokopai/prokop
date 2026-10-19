import { Suspense, lazy, useState } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { ArrowLeft, Bell, Bot, Boxes, Braces, ChevronRight, CircuitBoard, Cog, Cpu, FileText, Gauge, GraduationCap, Keyboard, MonitorCog, Palette, Shield, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dockHeaderClassName } from '@/components/ui/dock-header';
import { SectionLabel } from '@/components/ui/section-label';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { LoadingState } from '@/components/shared/States';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';
import { useServerClient } from '@/contexts/ServerClientContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { serverUpdateNotice, useServerUpdate } from '@/hooks/useServerUpdate';
import { getSelectableWorkspaces } from '@/lib/workspaceKind';
import { cn } from '@/lib/utils';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useUIStore, type ConfigurationSection } from '@/stores/uiStore';
import type { WorkspaceSettingsDraft, WorkspaceSettingsSection } from '@/components/modals/configuration/WorkspaceSettingsEditor';
import type { AgentEditorDraft } from '@/components/modals/configuration/PreconfigsPanel';

const MCPServersPanel = lazy(() => import('@/components/modals/configuration/MCPServersPanel').then(m => ({ default: m.MCPServersPanel })));
const WorkspacesPanel = lazy(() => import('@/components/modals/configuration/WorkspacesPanel').then(m => ({ default: m.WorkspacesPanel })));
const HarnessesPanel = lazy(() => import('@/components/modals/configuration/HarnessesPanel').then((m) => ({ default: m.HarnessesPanel })));
const UsagePanel = lazy(() => import('@/components/modals/configuration/UsagePanel').then((m) => ({ default: m.UsagePanel })));
const ProvidersModelsPanel = lazy(() => import('@/components/modals/configuration/ProvidersModelsPanel').then((m) => ({ default: m.ProvidersModelsPanel })));
const PromptsPanel = lazy(() => import('@/components/modals/configuration/PromptsPanel').then((m) => ({ default: m.PromptsPanel })));
const PreconfigsPanel = lazy(() => import('@/components/modals/configuration/PreconfigsPanel').then((m) => ({ default: m.PreconfigsPanel })));
const ResponseFormatsPanel = lazy(() => import('@/components/modals/configuration/ResponseFormatsPanel').then((m) => ({ default: m.ResponseFormatsPanel })));
const SystemPanel = lazy(() => import('@/components/modals/configuration/SystemPanel').then((m) => ({ default: m.SystemPanel })));
const AppearancePanel = lazy(() => import('@/components/modals/configuration/AppearancePanel').then((m) => ({ default: m.AppearancePanel })));
const NotificationsPanel = lazy(() => import('@/components/modals/configuration/NotificationsPanel').then((m) => ({ default: m.NotificationsPanel })));
const KeybindsPanel = lazy(() => import('@/components/modals/configuration/KeybindsPanel').then((m) => ({ default: m.KeybindsPanel })));
const DevicesPanel = lazy(() => import('@/components/modals/configuration/DevicesPanel').then((m) => ({ default: m.DevicesPanel })));

export interface SettingsSection {
  value: ConfigurationSection;
  label: string;
  /** Quiet 14px glyph for orientation in a long list; muted unless the row is selected. */
  icon: LucideIcon;
  group: string;
}

interface SettingsNavGroup {
  key: string;
  /** Omit for an unlabeled group (System, pinned to the bottom). */
  label?: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { value: 'appearance', label: 'Appearance', icon: Palette, group: 'preferences' },
  { value: 'notifications', label: 'Notifications', icon: Bell, group: 'preferences' },
  { value: 'keybinds', label: 'Keybinds', icon: Keyboard, group: 'preferences' },
  // Server: shared across harnesses (prompts are client-level text shortcuts, harness-agnostic)
  { value: 'mcp', label: 'Shared MCP servers', icon: Boxes, group: 'server' },
  { value: 'harnesses', label: 'Harnesses', icon: CircuitBoard, group: 'server' },
  { value: 'usage', label: 'Usage', icon: Gauge, group: 'server' },
  { value: 'devices', label: 'Devices', icon: Smartphone, group: 'server' },
  { value: 'preconfigs', label: 'Agents', icon: Bot, group: 'server' },
  { value: 'prompts', label: 'Prompts', icon: FileText, group: 'server' },
  // Prokop runtime
  { value: 'providers-models', label: 'Providers & models', icon: Cpu, group: 'prokop' },
  { value: 'response-formats', label: 'Formats', icon: Braces, group: 'prokop' },
  // System: connection and version, pinned to the bottom
  { value: 'system', label: 'System', icon: MonitorCog, group: 'system' },
];

export const WORKSPACE_SETTINGS_SECTIONS: SettingsSection[] = [
  { value: 'workspace-general', label: 'General', icon: Cog, group: 'workspace' },
  { value: 'workspace-mcp', label: 'MCP servers', icon: Boxes, group: 'workspace' },
  { value: 'workspace-permissions', label: 'Permissions', icon: Shield, group: 'workspace' },
  { value: 'workspace-learning', label: 'Memory & Learning', icon: GraduationCap, group: 'workspace' },
];

const GROUPS: SettingsNavGroup[] = [
  { key: 'preferences', label: 'Preferences' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'server', label: 'Server' },
  { key: 'prokop', label: 'Prokop' },
  { key: 'system' },
];

/** Legacy section ids that were merged into other pages. */
function normalizeSection(section: ConfigurationSection): ConfigurationSection {
  if (section === 'workspace-agentTools') return 'workspace-learning';
  if (section === 'workspace-sessions' || section === 'workspace-paths') return 'workspace-general';
  return section;
}

interface SettingsViewProps {
  sdkClient: ProkopaiClient | null;
  serverId: string;
  onLogout: () => void;
}

/**
 * Settings as a workspace view: a flat nav list on the left, one page on the
 * right, both regions of the same surface. The phone shows the list first
 * and each page with a back button. Workspace pages carry a workspace row
 * at the top so the scope is always visible.
 */
export function SettingsView({ sdkClient, serverId, onLogout }: SettingsViewProps) {
  const { apiToken, connected } = useServerClient();
  const isMobile = useIsMobile();
  const storedSection = useUIStore((s) => s.configurationSection);
  const setSection = useUIStore((s) => s.setConfigurationSection);
  const section = normalizeSection(storedSection);
  // The phone opens on the list; a page is one tap deeper.
  const [listOpen, setListOpen] = useState(true);
  // The view mounts once per server, capturing the workspace it was opened from.
  const [workspaceId, setWorkspaceId] = useState(() => useServerDataStore.getState().activeWorkspaceId ?? null);
  const [workspaceDrafts, setWorkspaceDrafts] = useState<Record<string, WorkspaceSettingsDraft>>({});
  const [agentDraft, setAgentDraft] = useState<AgentEditorDraft | null>(null);
  const updateVersion = useServerUpdate();
  const workspaces = useServerDataStore(s => s.workspaces);
  const agents = useServerDataStore(s => s.agents);
  const selectable = getSelectableWorkspaces(workspaces, agents);
  const workspace = selectable.find(item => item.id === workspaceId) ?? selectable[0];
  const sections = [...SETTINGS_SECTIONS, ...(workspace ? WORKSPACE_SETTINGS_SECTIONS : [])];
  const activeSection = sections.some(item => item.value === section) ? section
    : workspace ? 'workspace-general' : 'appearance';
  const activeLabel = sections.find(item => item.value === activeSection)?.label ?? 'Settings';
  const sectionsFor = (group: string) => sections.filter((s) => s.group === group);

  const select = (value: ConfigurationSection) => {
    setSection(value);
    setListOpen(false);
  };

  const renderPanel = () => {
    if (activeSection.startsWith('workspace-') && workspace) {
      const workspaceSection = activeSection.slice('workspace-'.length) as WorkspaceSettingsSection;
      return <>
        <div role="group" aria-label="Workspace settings scope" className="p-3 pb-0 sm:p-4 sm:pb-0">
          <SettingsGroup>
            <SettingsRow label="Workspace">
              <WorkspaceSwitcher selectionOnly workspaces={selectable} agents={agents} activeWorkspace={workspace}
                onSelectWorkspace={selected => setWorkspaceId(selected.id)} />
            </SettingsRow>
          </SettingsGroup>
        </div>
        <WorkspacesPanel workspace={workspace} section={workspaceSection}
          sdkClient={sdkClient} drafts={workspaceDrafts} setDrafts={setWorkspaceDrafts} />
      </>;
    }
    switch (activeSection) {
      case 'system':
        return <SystemPanel apiToken={apiToken} isConnected={connected} onLogout={onLogout} sdkClient={sdkClient} open />;
      case 'appearance':
        return <AppearancePanel />;
      case 'notifications':
        return <NotificationsPanel />;
      case 'keybinds':
        return <KeybindsPanel />;
      case 'mcp':
        return <MCPServersPanel workspaceId={null} sdkClient={sdkClient} />;
      case 'harnesses':
        return <HarnessesPanel sdkClient={sdkClient} />;
      case 'usage':
        return <UsagePanel sdkClient={sdkClient} />;
      case 'devices':
        return <DevicesPanel sdkClient={sdkClient} />;
      case 'preconfigs':
        return <PreconfigsPanel sdkClient={sdkClient} draft={agentDraft} onDraftChange={setAgentDraft} />;
      case 'providers-models':
        return <ProvidersModelsPanel sdkClient={sdkClient} />;
      case 'prompts':
        return <PromptsPanel sdkClient={sdkClient} />;
      case 'response-formats':
        return <ResponseFormatsPanel sdkClient={sdkClient} />;
      default:
        return null;
    }
  };

  const nav = (
    <nav aria-label="Settings navigation" className={cn(
      'flex min-h-0 flex-col overflow-y-auto bg-sidebar py-1',
      isMobile ? 'flex-1' : 'w-50 shrink-0 border-r border-border/50',
    )}>
      {GROUPS.map((group) => (
        <div key={group.key} role="group" aria-label={group.label ?? 'System'} className="flex shrink-0 flex-col">
          {group.label
            ? <SectionLabel className="px-3 pt-3 pb-1">{group.label}</SectionLabel>
            : <div className="mx-3 my-1.5 border-t border-border/50" aria-hidden="true" />}
          {group.key === 'workspace' && !workspace && (
            <p className="px-3 py-1 text-xs text-muted-foreground">No workspaces on this server yet.</p>
          )}
          <div role="tablist" aria-orientation="vertical" aria-label={group.label ?? 'System'} className="flex flex-col">
            {sectionsFor(group.key).map((item) => {
              const selected = item.value === activeSection;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => select(item.value)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 border-l-2 pr-2 pl-3 text-left text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
                    isMobile ? 'h-9' : 'h-7',
                    selected && !isMobile
                      ? 'border-highlight bg-highlight/10 text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                    isMobile && 'text-foreground',
                  )}
                >
                  <item.icon aria-hidden="true" className={cn('size-3.5 shrink-0', selected && !isMobile ? 'text-foreground' : 'text-muted-foreground/70')} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {isMobile && <ChevronRight className="size-3.5 text-muted-foreground" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const page = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={cn(dockHeaderClassName(true), 'gap-1')}>
        {isMobile && (
          <Button variant="ghost" size="icon-xs" aria-label="All settings" onClick={() => setListOpen(true)}>
            <ArrowLeft />
          </Button>
        )}
        <h2 className="truncate px-1 text-sm font-medium">{activeLabel}</h2>
      </div>
      <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Suspense fallback={<LoadingState />}>
          {renderPanel()}
        </Suspense>
        {updateVersion && (
          <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4 sm:pb-4">
            {serverUpdateNotice(updateVersion).title}. {serverUpdateNotice(updateVersion).hint}
          </p>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return <div data-settings-server={serverId} className="flex h-full min-h-0 flex-col">{listOpen ? nav : page}</div>;
  }
  return <div data-settings-server={serverId} className="flex h-full min-h-0">{nav}{page}</div>;
}
