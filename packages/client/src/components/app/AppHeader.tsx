import { SegmentedControl } from '@/components/ui/segmented-control';
import { Check, LayoutGrid, LayoutList } from 'lucide-react';
import { useRouter, useParams, useLocation } from '@tanstack/react-router';
import { useIsMobile } from '@/hooks/use-mobile';
import { useServerUpdate } from '@/hooks/useServerUpdate';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ServerSwitcher } from '@/components/layout/ServerSwitcher';
import { HeaderPanelToggles } from '@/components/app/HeaderPanelToggles';
import { useServerDataStore, selectActiveWorkspace } from '@/stores/serverDataStore';
import { isRegionOpen, settingsViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';

/**
 * Single title bar: server context and view navigation on the left, shell
 * panel toggles and settings on the right. Per-surface headers live inside
 * their own cards.
 */
export function AppHeader() {
  const router = useRouter();
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const location = useLocation();
  const isOverview = location.pathname.includes('/overview');
  const isMobile = useIsMobile();
  const updateVersion = useServerUpdate();

  const activeWorkspace = useServerDataStore(selectActiveWorkspace);

  // One toggle per region; the store decides whether that means a dock or a phone surface.
  const docks = useDockStore((s) => s.docks);
  const mobileSurface = useWorkspaceViewStore((s) => s.mobileSurface);
  const mobileTerminalOpen = useWorkspaceViewStore((s) => s.mobileTerminalOpen);
  const toggleRegion = useWorkspaceViewStore((s) => s.toggleRegion);
  const regionOpen = (position: 'left' | 'right' | 'bottom') => isRegionOpen({ mobileSurface, mobileTerminalOpen }, docks, position, isMobile);

  const goWorkspace = () =>
    router.navigate({ to: '/server/$serverId/workspace', params: { serverId: params.serverId } });
  const goOverview = () =>
    router.navigate({ to: '/server/$serverId/overview', params: { serverId: params.serverId } });
  // Settings is a tab in the workspace; from the overview, go there first.
  const openSettings = () => {
    useWorkspaceViewStore.getState().openInCenter(settingsViewId(params.serverId));
    if (isOverview) void goWorkspace();
  };

  const panelToggles = (
    <HeaderPanelToggles
      leftActive={regionOpen('left')}
      onToggleLeft={() => toggleRegion('left')}
      rightActive={regionOpen('right')}
      onToggleRight={() => toggleRegion('right')}
      bottomActive={regionOpen('bottom')}
      onToggleBottom={() => toggleRegion('bottom')}
      hasRightDock={Boolean(activeWorkspace)}
      mobile={isMobile}
      onOpenSettings={openSettings}
      updateVersion={updateVersion}
    />
  );

  return (
    <>
      <header
        className="sm:hidden sticky top-0 z-40 flex shrink-0 items-center justify-between px-1 pb-2"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <ServerSwitcher compact />
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="View" title="View">
                {isOverview ? <LayoutGrid className="size-4" /> : <LayoutList className="size-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 min-w-48">
              <DropdownMenuItem onClick={goWorkspace}>
                <span className="flex-1">Single workspace</span>
                {!isOverview && <Check className="size-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={goOverview}>
                <span className="flex-1">Overview</span>
                {isOverview && <Check className="size-4" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {panelToggles}
        </div>
      </header>

      <header className="app-titlebar hidden sm:flex h-11 shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ServerSwitcher compact />
          <SegmentedControl
            label="View"
            options={[
              { value: 'workspace', label: 'Workspace', icon: LayoutList },
              { value: 'overview', label: 'Overview', icon: LayoutGrid },
            ]}
            value={isOverview ? 'overview' : 'workspace'}
            onChange={(view) => { if (view === 'overview') goOverview(); else goWorkspace(); }}
          />
        </div>

        {panelToggles}
      </header>
    </>
  );
}
