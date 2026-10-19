import { LoadingState } from '@/components/shared/States';
import type { ReactNode } from 'react';
import type { HarnessStatus, HarnessUsageLimits, ProviderAccountSummary, ProviderUsageWindow, UsageProvider, ProkopaiClient } from '@prokopai/sdk';
import { useCodexAccountUsageQuery, useProvidersQuery, useProviderCredentialsQuery, useProviderUsageQuery } from '@/hooks/queries/useProvidersQueries';
import { ArrowDown, ArrowUp, EyeOff, Loader2, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useHarnessesQuery, useHarnessUsageQuery, isHarnessEnabled } from '@/hooks/queries';
import { useUsageLayout } from '@/hooks/useUsageLayout';
import { arrangeUsageEntries } from '@/lib/usageLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { ProviderTile } from '@/components/branding/ProviderTile';
import { cn } from '@/lib/utils';
import { useNow } from '@/hooks/useNow';

interface UsagePanelProps {
  sdkClient: ProkopaiClient | null;
}

type UsageHarness = HarnessUsageLimits['harness'];

const USAGE_HARNESSES: { id: UsageHarness; name: string }[] = [
  { id: 'claude-cli', name: 'Claude CLI' },
  { id: 'codex-cli', name: 'Codex CLI' },
];

/** Coarse remaining time: `5d 4h`, `3h 20m`, `12m`. */
export function formatResetIn(resetsAt: string, now: number): string {
  const totalMinutes = Math.max(0, Math.ceil((Date.parse(resetsAt) - now) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
  if (hours === 0) return `${totalMinutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** One usage window as a row: the label left, the percentage and bar right. */
function UsageWindowRow({ window, now }: { window: ProviderUsageWindow; now: number }) {
  if (window.unlimited) {
    return (
      <SettingsRow label={window.label}>
        <span className="text-xs text-muted-foreground">Unlimited</span>
      </SettingsRow>
    );
  }
  const used = Math.round(window.usedPercent);
  return (
    <SettingsRow label={window.label}>
      <div className="flex w-full flex-col gap-1 sm:w-48">
        <span className="text-xs text-muted-foreground tabular-nums sm:text-right">
          {used}% used
          {window.resetsAt && (
            <span title={new Date(window.resetsAt).toLocaleString()}> · resets in {formatResetIn(window.resetsAt, now)}</span>
          )}
        </span>
        <Progress
          value={used}
          aria-label={`${window.label} usage`}
          className={cn(used >= 90 && '[&_[data-slot=progress-indicator]]:bg-error')}
        />
      </div>
    </SettingsRow>
  );
}

/** A note instead of windows: not installed, not enabled, unreadable. */
function UsageNote({ children }: { children: ReactNode }) {
  return <SettingsRow label={<span className="text-xs text-muted-foreground">{children}</span>} />;
}

/** Coarse snapshot age: `just now`, `4m ago`, `2h ago`. */
export function formatCheckedAgo(checkedAt: number, now: number): string {
  const minutes = Math.floor((now - checkedAt) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function UsageRefreshButton({ label, fetching, disabled = false, onRefresh, updatedAt, now }: {
  label: string;
  fetching: boolean;
  disabled?: boolean;
  onRefresh: () => void;
  /** When the shown numbers were read, 0 before the first read. */
  updatedAt: number;
  now: number;
}) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {updatedAt > 0 && !disabled && (
        <span className="text-2xs text-muted-foreground tabular-nums" title={`Checked ${new Date(updatedAt).toLocaleString()}`}>
          {formatCheckedAgo(updatedAt, now)}
        </span>
      )}
      <Button variant="ghost" size="icon-xs" className="text-muted-foreground"
        aria-label={label} disabled={fetching || disabled} onClick={onRefresh}>
        <RefreshCw className={cn('size-3', fetching && 'animate-spin')} />
      </Button>
    </span>
  );
}

interface UsageArrangement {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onHide: () => void;
}

/** The same overflow menu as a session row: a step up or down, or out of the panel. */
function UsageGroupMenu({ name, arrangement }: { name: string; arrangement: UsageArrangement }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`${name} options`}>
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem disabled={!arrangement.canMoveUp} onSelect={() => arrangement.onMove('up')}><ArrowUp />Move up</DropdownMenuItem>
        <DropdownMenuItem disabled={!arrangement.canMoveDown} onSelect={() => arrangement.onMove('down')}><ArrowDown />Move down</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={arrangement.onHide}><EyeOff />Hide from Usage</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Group header: name, plan badge, and the refresh control at the right; the tile sits before it. */
function UsageHeading({ name, plan, children }: { name: ReactNode; plan?: string | null; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 truncate">{name}</span>
      {plan && <Badge variant="secondary" className="capitalize">{plan}</Badge>}
      {children}
    </span>
  );
}

function HarnessUsageCard({ sdkClient, harness, status, now, menu }: {
  sdkClient: ProkopaiClient | null;
  harness: (typeof USAGE_HARNESSES)[number];
  status: HarnessStatus | undefined;
  now: number;
  menu?: ReactNode;
}) {
  const ready = !!status?.available && isHarnessEnabled(status);
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useHarnessUsageQuery(sdkClient, harness.id, ready);

  let body;
  if (!status?.available) {
    body = <UsageNote>Install the CLI on this host to see its usage.</UsageNote>;
  } else if (!ready) {
    body = <UsageNote>Enable {harness.name} in Harnesses to see its usage.</UsageNote>;
  } else if (isLoading) {
    body = <UsageNote><Loader2 className="size-3.5 animate-spin" /></UsageNote>;
  } else if (isError || !data) {
    body = <UsageNote>Could not read usage from the server.</UsageNote>;
  } else if (data.unavailable) {
    body = <UsageNote>{data.unavailable.message ?? 'Usage is unavailable.'}</UsageNote>;
  } else {
    body = data.windows.map((window) => <UsageWindowRow key={window.id} window={window} now={dataUpdatedAt} />);
  }

  return (
    <SettingsGroup icon={<ProviderTile provider={harness.id} name={harness.name} />} label={
      <UsageHeading name={harness.name} plan={data?.plan}>
        {ready && (
          <UsageRefreshButton label={`Refresh ${harness.name} usage`} fetching={isFetching}
            onRefresh={() => void refetch()} updatedAt={dataUpdatedAt} now={now} />
        )}
        {!ready && <span className="ml-auto" />}
        {menu}
      </UsageHeading>
    }>
      {body}
    </SettingsGroup>
  );
}

const USAGE_PROVIDERS: { id: UsageProvider; name: string }[] = [
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'zhipu-coding', name: 'Z.AI Coding Plan' },
  { id: 'minimax', name: 'MiniMax' },
];

function ProviderUsageCard({ sdkClient, provider, now, menu }: UsagePanelProps & { provider: (typeof USAGE_PROVIDERS)[number]; now: number; menu?: ReactNode }) {
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useProviderUsageQuery(sdkClient, provider.id);
  return (
    <SettingsGroup icon={<ProviderTile provider={provider.id} name={provider.name} />} label={
      <UsageHeading name={provider.name} plan={data?.plan}>
        <UsageRefreshButton label={`Refresh ${provider.name} usage`} fetching={isFetching}
          onRefresh={() => void refetch()} updatedAt={dataUpdatedAt} now={now} />
        {menu}
      </UsageHeading>
    }>
      {isLoading ? <UsageNote><Loader2 className="size-3.5 animate-spin" /></UsageNote>
        : isError || !data ? <UsageNote>Could not read usage from the server.</UsageNote>
        : data.unavailable ? <UsageNote>{data.unavailable.message}</UsageNote>
        : <>
          {data.balances.map(balance => (
            <SettingsRow key={balance.currency} label="Balance"
              description={(balance.granted != null || balance.toppedUp != null) ? [
                balance.granted != null ? `Granted ${balance.granted} ${balance.currency}` : null,
                balance.toppedUp != null ? `Topped up ${balance.toppedUp} ${balance.currency}` : null,
              ].filter(Boolean).join(' · ') : undefined}>
              <span className="text-xs tabular-nums">{balance.remaining} {balance.currency} remaining</span>
            </SettingsRow>
          ))}
          {data.windows.map(window => <UsageWindowRow key={window.id} window={window} now={dataUpdatedAt} />)}
        </>}
    </SettingsGroup>
  );
}

function CodexAccountUsageCard({ sdkClient, account, active, now, menu }: UsagePanelProps & { account: ProviderAccountSummary; active: boolean; now: number; menu?: ReactNode }) {
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useCodexAccountUsageQuery(sdkClient, account);
  return (
    <SettingsGroup aria-label={`Codex · ${account.label}`} icon={<ProviderTile provider="codex" name="Codex" />} label={
      <UsageHeading name={`Codex · ${account.label}`} plan={account.reauthRequired ? null : data?.plan}>
        {active && <Badge variant="outline">Active</Badge>}
        <UsageRefreshButton label={`Refresh Codex ${account.label} usage`} fetching={isFetching}
          disabled={account.reauthRequired} onRefresh={() => void refetch()} updatedAt={dataUpdatedAt} now={now} />
        {menu}
      </UsageHeading>
    }>
      {account.reauthRequired ? <UsageNote>Reconnect this Codex account in Providers &amp; Models.</UsageNote>
        : isLoading ? <UsageNote><Loader2 className="size-3.5 animate-spin" /></UsageNote>
        : isError || !data ? <UsageNote>Could not read usage for this Codex account.</UsageNote>
        : data.unavailable ? <UsageNote>{data.unavailable.message}</UsageNote>
        : data.windows.map(window => <UsageWindowRow key={window.id} window={window} now={dataUpdatedAt} />)}
    </SettingsGroup>
  );
}

export function UsagePanel({ sdkClient }: UsagePanelProps) {
  const { data, isLoading } = useHarnessesQuery(sdkClient);
  const credentials = useProviderCredentialsQuery(sdkClient);
  const providers = useProvidersQuery(sdkClient);
  const codex = providers.data?.providers.find(provider => provider.provider === 'codex');
  const configuredProviders = USAGE_PROVIDERS.filter(provider =>
    credentials.data?.providers.some(entry => entry.provider === provider.id && entry.configured));
  const now = useNow(30_000);
  const { layout, move, hide, show } = useUsageLayout();

  if (isLoading) {
    return <LoadingState />;
  }

  // Every group the panel could show, in its natural order; the layout then
  // reorders and hides. Ids are stable across reloads: a Codex account by its
  // account id, providers and CLIs by their own ids.
  const entries: UsageEntry[] = [
    ...(codex?.accounts ?? []).map((account): UsageEntry => ({ id: `codex:${account.id}`, name: `Codex · ${account.label}`,
      render: menu => <CodexAccountUsageCard key={`${account.id}:${account.connectionId}`} sdkClient={sdkClient}
        account={account} active={codex!.activeAccountId === account.id} now={now} menu={menu} /> })),
    ...configuredProviders.map((provider): UsageEntry => ({ id: provider.id, name: provider.name,
      render: menu => <ProviderUsageCard key={provider.id} sdkClient={sdkClient} provider={provider} now={now} menu={menu} /> })),
    ...USAGE_HARNESSES.map((harness): UsageEntry => ({ id: harness.id, name: harness.name,
      render: menu => <HarnessUsageCard key={harness.id} sdkClient={sdkClient} harness={harness}
        status={data?.harnesses.find((entry) => entry.id === harness.id)} now={now} menu={menu} /> })),
  ];
  const { visible, hidden } = arrangeUsageEntries(entries, layout);
  const visibleIds = visible.map(entry => entry.id);

  return (
    // Two accounts per row once the panel is wide enough: a bottom dock, a wide settings page.
    <div className="@container">
    <div className="grid grid-cols-1 gap-4 p-3 @3xl:grid-cols-2 @3xl:items-start sm:p-4">
      {credentials.isLoading && <LoadingState inline label="Loading provider accounts…" className="@3xl:col-span-2" />}
      {credentials.isError && <p className="text-xs text-muted-foreground @3xl:col-span-2">Could not load configured provider accounts.</p>}
      {providers.isLoading && <LoadingState inline label="Loading Codex accounts…" className="@3xl:col-span-2" />}
      {providers.isError && <p className="text-xs text-muted-foreground @3xl:col-span-2">Could not load Codex accounts.</p>}
      {visible.map((entry, index) => entry.render(
        <UsageGroupMenu name={entry.name} arrangement={{
          canMoveUp: index > 0, canMoveDown: index < visible.length - 1,
          onMove: direction => move(visibleIds, entry.id, direction), onHide: () => hide(entry.id) }} />,
      ))}
      {hidden.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-1 px-1 text-xs text-muted-foreground @3xl:col-span-2">
          <span>Hidden:</span>
          {hidden.map((entry, index) => (
            <span key={entry.id}>
              <button type="button" className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                title={`Show ${entry.name} in Usage`} onClick={() => show(entry.id)}>{entry.name}</button>
              {index < hidden.length - 1 && <span> ·</span>}
            </span>
          ))}
        </p>
      )}
    </div>
    </div>
  );
}

interface UsageEntry {
  id: string;
  name: string;
  render: (menu: ReactNode) => ReactNode;
}
