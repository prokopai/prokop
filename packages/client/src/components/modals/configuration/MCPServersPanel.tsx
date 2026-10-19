import { EmptyState, ErrorState } from '@/components/shared/States';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { McpBuiltinId, McpServerConfig, McpStatus, ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { McpServerForm } from './McpServerForm';

interface Props { workspaceId: string | null | undefined; sdkClient: ProkopaiClient | null }
const BUILTIN_DESCRIPTIONS: Record<McpBuiltinId, string> = {
  browser: 'Browser tools for Prokop, Claude Code and Codex CLI.',
  visuals: 'Lets agents show charts, tables and diagrams as pages in their replies.',
};

const statusLabels: Record<McpStatus['status'], string> = {
  connected: 'Connected', disabled: 'Disconnected', failed: 'Connection failed',
  needs_auth: 'Sign-in required', needs_client_registration: 'Client registration required',
};

export function MCPServersPanel({ workspaceId, sdkClient }: Props) {
  if (workspaceId === undefined || !sdkClient) return <EmptyState variant="plain">Connect to a server to manage MCP.</EmptyState>;
  return <McpSettings key={workspaceId ?? 'global'} workspaceId={workspaceId} client={sdkClient} />;
}

function McpSettings({ workspaceId, client }: { workspaceId: string | null; client: ProkopaiClient }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState<{ name?: string; config?: McpServerConfig }>();
  const [search, setSearch] = useState('');
  const [authLink, setAuthLink] = useState<{ name: string; url: string }>();
  const status = useQuery({ queryKey: queryKeys.mcp.status(workspaceId),
    queryFn: ({ signal }) => client.http.mcp.getStatus(workspaceId, { signal }) });
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: queryKeys.mcp.status(workspaceId) });
      void cache.invalidateQueries({ queryKey: queryKeys.mcp.tools(workspaceId) });
    },
  });
  const run = (operation: () => Promise<unknown>) => { action.mutate(operation); };
  const servers = Object.entries(status.data?.status ?? {});
  const error = action.error ?? status.error;
  const shown = servers.filter(([name]) => name.toLowerCase().includes(search.toLowerCase()));
  return <div className="flex flex-col gap-4 p-3 sm:p-4">
    <SettingsGroup description={workspaceId === null ? 'Tools available across all workspaces.' : 'Workspace connections override global connections with the same name.'}>
      <SettingsRow label="Add a server" description="A remote URL or a local command.">
        <Button variant="outline" disabled={!!editing || action.isPending} onClick={() => setEditing({})}>
          <Plus data-icon="inline-start" />Add server
        </Button>
      </SettingsRow>
      {servers.length > 5 && (
        <SettingsRow label="Search" htmlFor="mcp-search">
          <Input id="mcp-search" aria-label="Search MCP servers" placeholder="Search servers…" value={search} onChange={e => setSearch(e.target.value)} className="sm:w-64" />
        </SettingsRow>
      )}
    </SettingsGroup>
    {error && <ErrorState>{error.message}</ErrorState>}
    {authLink && status.data?.status[authLink.name]?.status.status !== 'connected' && <p className="text-sm">
      <a className="underline" href={authLink.url} target="_blank" rel="noopener noreferrer">Continue sign-in</a>
    </p>}
    {editing && <McpServerForm key={editing.name ?? '__new__'} {...editing} names={servers.map(([name]) => name)} pending={action.isPending}
      onCancel={() => setEditing(undefined)} onSave={async (name, config) => {
        await action.mutateAsync(() => client.http.mcp.save(workspaceId, name, config)); setEditing(undefined);
      }} />}
    {status.isLoading ? <Skeleton className="h-16" /> : servers.length === 0
      ? <EmptyState variant="plain">No MCP servers yet. Add a remote URL or a local command.</EmptyState>
      : shown.map(([name, { config, status: connection }]) => config && (
        <SettingsGroup key={name} label={
          <>
            <span className="min-w-0 truncate text-foreground">{name}</span>
            <Badge variant={connection.status === 'failed' ? 'error' : 'secondary'}>
              {config.enabled === false ? 'Disabled' : config.type === 'builtin' && config.id === 'browser' && connection.status !== 'connected' ? 'Extension not connected' : statusLabels[connection.status]}
            </Badge>
            {config.type === 'builtin' && <Badge variant="outline">Built-in</Badge>}
            {config.type !== 'builtin' && <span className="ml-auto flex items-center">
              <Button size="icon-xs" variant="ghost" aria-label={'Edit ' + name} disabled={action.isPending}
                onClick={() => setEditing({ name, config })}><Pencil /></Button>
              <Button size="icon-xs" variant="ghost" aria-label={'Remove ' + name} disabled={action.isPending}
                onClick={() => run(() => client.http.mcp.remove(workspaceId, name))}><Trash2 /></Button>
            </span>}
          </>
        }>
          <SettingsRow
            label="Enabled"
            htmlFor={`mcp-enabled-${name}`}
            description={<span className="truncate">{config.type === 'builtin' ? BUILTIN_DESCRIPTIONS[config.id] : config.type === 'remote' ? config.url : config.command.join(' ')}</span>}
          >
            <Switch id={`mcp-enabled-${name}`} aria-label={'Enable ' + name} checked={config.enabled !== false} disabled={action.isPending}
              onCheckedChange={enabled => run(() => client.http.mcp.save(workspaceId, name, { ...config, enabled }))} />
          </SettingsRow>
          {'error' in connection && (
            <SettingsRow label={<span className="text-xs text-error">{connection.error}</span>} />
          )}
          {config.type !== 'builtin' && config.enabled !== false && connection.status !== 'connected' && (
            <SettingsRow label="Connection" description={statusLabels[connection.status]}>
              <span className="flex items-center gap-1">
                <Button variant="outline" size="xs" disabled={action.isPending}
                  onClick={() => run(() => client.http.mcp.connect(workspaceId, name))}><RefreshCw data-icon="inline-start" />Connect</Button>
                {config.type === 'remote' && config.oauth !== false && <Button variant="outline" size="xs"
                  disabled={action.isPending} onClick={() => {
                    // Open during the click so the browser does not block the asynchronous OAuth redirect.
                    const popup = window.open('about:blank', '_blank');
                    if (popup) popup.opener = null;
                    run(async () => {
                      try {
                        const { authorizationUrl } = await client.http.mcp.startAuth(workspaceId, name);
                        setAuthLink({ name, url: authorizationUrl });
                        if (popup) popup.location.href = authorizationUrl;
                      } catch (error: unknown) { popup?.close(); throw error; }
                    });
                  }}><ExternalLink data-icon="inline-start" />Sign in</Button>}
              </span>
            </SettingsRow>
          )}
          {config.type === 'builtin' && config.id === 'browser' && (
            <SettingsRow label="Browser extension" stacked>
              <details className="w-full text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">Set up browser extension</summary>
                <ol className="mt-2 flex list-inside list-decimal flex-col gap-2 text-xs text-muted-foreground">
                  <li><a className="underline" href="https://github.com/prokopai/prokop/releases?q=browser%2F&expanded=true" target="_blank" rel="noopener noreferrer">Download the Prokop Browser extension</a> ZIP from a browser release and extract it.</li>
                  <li>Open <code>chrome://extensions</code>, enable Developer mode, choose Load unpacked, and select the extracted folder containing <code>manifest.json</code>.</li>
                  <li>Open the extension, enter this Prokop server URL and API token, and connect. Keep only one browser profile connected.</li>
                  <li>Enable Prokop Browser here, then start a new turn. Existing Prokop agents should use this MCP entry instead of their old browser tool selections.</li>
                </ol>
              </details>
            </SettingsRow>
          )}
          {(connection.status === 'connected' || config.type === 'builtin') && config.enabled !== false && <McpTools workspaceId={workspaceId} name={name} client={client} />}
        </SettingsGroup>
      ))}
  </div>;
}

function McpTools({ workspaceId, name, client }: { workspaceId: string | null; name: string; client: ProkopaiClient }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const cache = useQueryClient();
  const key = queryKeys.mcp.tools(workspaceId, name);
  const tools = useQuery({ queryKey: key, queryFn: ({ signal }) => client.http.mcp.getTools(workspaceId, name, { signal }), enabled: open });
  const toggle = useMutation({ mutationFn: ({ toolName, enabled }: { toolName: string; enabled: boolean }) =>
    client.http.mcp.setToolEnabled(workspaceId, name, toolName, enabled),
  onSuccess: () => {
    void cache.invalidateQueries({ queryKey: key });
    void cache.invalidateQueries({ queryKey: queryKeys.mcp.status(workspaceId) });
  } });
  const all = tools.data?.tools ?? [];
  const count = tools.data ? `${all.filter(tool => tool.enabled).length} of ${all.length} allowed` : undefined;
  return <>
    <SettingsRow label="Tools" description={count}>
      <Button variant="outline" size="xs" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide tools' : 'Choose tools'}
      </Button>
    </SettingsRow>
    {open && <>
      {(tools.error || toggle.error) && <SettingsRow label={<span className="text-xs text-error">{(tools.error ?? toggle.error)?.message}</span>} />}
      {tools.isLoading ? <SettingsRow label={<Skeleton className="h-4 w-40" />} /> : <>
        {all.length > 8 && (
          <SettingsRow label="Search tools" htmlFor={`mcp-tools-search-${name}`}>
            <Input id={`mcp-tools-search-${name}`} aria-label={'Search tools in ' + name} placeholder="Search tools…" value={search} onChange={e => setSearch(e.target.value)} className="sm:w-64" />
          </SettingsRow>
        )}
        {all.filter(tool => (tool.name + ' ' + (tool.description ?? '')).toLowerCase().includes(search.toLowerCase())).map(tool =>
          <SettingsRow key={tool.name} label={<span className="font-mono text-xs [overflow-wrap:anywhere]">{tool.name}</span>} description={tool.description} htmlFor={`mcp-tool-${name}-${tool.name}`}>
            <Switch id={`mcp-tool-${name}-${tool.name}`} aria-label={'Allow ' + tool.name} checked={tool.enabled} disabled={toggle.isPending}
              onCheckedChange={enabled => toggle.mutate({ toolName: tool.name, enabled })} />
          </SettingsRow>)}
        {all.length === 0 && <SettingsRow label={<span className="text-xs text-muted-foreground">This server has no tools.</span>} />}
      </>}
    </>}
  </>;
}
