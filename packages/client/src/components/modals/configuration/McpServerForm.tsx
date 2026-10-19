import { useId, useState } from 'react';
import type { McpServerConfig } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorState } from '@/components/shared/States';

function parsePairs(value: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of value.split('\n').filter(line => line.trim())) {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Use one NAME=value entry per line.');
    const name = line.slice(0, separator).trim();
    if (!name || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid entry name.');
    pairs[name] = line.slice(separator + 1);
  }
  return pairs;
}
const formatPairs = (value?: Record<string, string>): string => Object.entries(value ?? {}).map(([key, value]) => key + '=' + value).join('\n');

/** The add or edit form for one MCP server: a group of rows with the actions under it. */
export function McpServerForm({ name: originalName, config, names, pending, onSave, onCancel }: {
  name?: string; config?: McpServerConfig; names: string[]; pending: boolean;
  onSave(name: string, config: McpServerConfig): Promise<void>; onCancel(): void;
}) {
  const id = useId();
  const [name, setName] = useState(originalName ?? '');
  const [type, setType] = useState<'local' | 'remote'>(config?.type === 'local' ? 'local' : 'remote');
  const [url, setUrl] = useState(config?.type === 'remote' ? config.url : '');
  const [command, setCommand] = useState(config?.type === 'local' ? config.command[0] : '');
  const [args, setArgs] = useState(config?.type === 'local' ? config.command.slice(1).join('\n') : '');
  const [env, setEnv] = useState(config?.type === 'local' ? formatPairs(config.env) : '');
  const [headers, setHeaders] = useState(config?.type === 'remote' ? formatPairs(config.headers) : '');
  const initialOAuth = config?.type === 'remote' && typeof config.oauth === 'object' ? config.oauth : {};
  const [oauth, setOauth] = useState(config?.type !== 'remote' || config.oauth !== false);
  const [clientId, setClientId] = useState(initialOAuth.clientId ?? '');
  const [clientSecret, setClientSecret] = useState(initialOAuth.clientSecret ?? '');
  const [scope, setScope] = useState(initialOAuth.scope ?? '');
  const [showAuth, setShowAuth] = useState(false);
  const [error, setError] = useState<string>();
  return <form className="flex flex-col gap-3" onSubmit={async event => {
    event.preventDefault();
    setError(undefined);
    try {
      const trimmed = name.trim();
      if (!trimmed || !originalName && names.includes(trimmed)) throw new Error('Choose a unique server name.');
      const common = { enabled: config?.enabled ?? true, disabledTools: config?.disabledTools ?? [], timeout: config?.timeout };
      const next: McpServerConfig = type === 'local'
        ? { ...common, type, command: [command.trim(), ...args.split('\n').filter(Boolean)], env: parsePairs(env) }
        : { ...common, type, url: url.trim(), headers: parsePairs(headers),
          oauth: oauth ? { ...(clientId ? { clientId } : {}), ...(clientSecret ? { clientSecret } : {}), ...(scope ? { scope } : {}) } : false };
      await onSave(trimmed, next);
    } catch (error: unknown) { setError(error instanceof Error ? error.message : 'Unable to save server'); }
  }}>
    <fieldset disabled={pending} className="contents">
      <SettingsGroup label={originalName ? 'Edit server' : 'Add MCP server'}>
        <SettingsRow label="Name" htmlFor={id + '-name'}>
          <Input id={id + '-name'} value={name} disabled={!!originalName} required maxLength={100}
            placeholder="e.g. Pipedream" onChange={event => setName(event.target.value)} className="sm:w-64" />
        </SettingsRow>
        <SettingsRow label="Connection" htmlFor={id + '-type'}>
          <Select value={type} onValueChange={value => setType(value as 'local' | 'remote')}>
            <SelectTrigger id={id + '-type'}><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="remote">Remote URL</SelectItem>
              <SelectItem value="local">Local command</SelectItem></SelectGroup></SelectContent>
          </Select>
        </SettingsRow>
        {type === 'remote' ? <>
          <SettingsRow label="MCP server URL" htmlFor={id + '-url'}>
            <Input id={id + '-url'} type="url" required placeholder="https://example.com/mcp" value={url}
              onChange={event => setUrl(event.target.value)} className="sm:w-80" />
          </SettingsRow>
          <SettingsRow label="Sign in with OAuth" htmlFor={id + '-oauth'}>
            <Switch id={id + '-oauth'} checked={oauth} onCheckedChange={setOauth} />
          </SettingsRow>
          <SettingsRow label="Authentication details" description={oauth ? 'Leave client details empty if the server supports automatic registration.' : undefined}>
            <Button type="button" variant="ghost" size="xs" aria-expanded={showAuth} onClick={() => setShowAuth(!showAuth)}>
              {showAuth ? 'Hide' : 'Show'}
            </Button>
          </SettingsRow>
          {showAuth && oauth && <>
            <SettingsRow label="Client ID" htmlFor={id + '-client'}>
              <Input id={id + '-client'} value={clientId} onChange={event => setClientId(event.target.value)} className="sm:w-64" />
            </SettingsRow>
            <SettingsRow label="Client secret" htmlFor={id + '-secret'}>
              <Input id={id + '-secret'} type="password" autoComplete="new-password" value={clientSecret}
                onChange={event => setClientSecret(event.target.value)} className="sm:w-64" />
            </SettingsRow>
            <SettingsRow label="OAuth scopes" htmlFor={id + '-scope'}>
              <Input id={id + '-scope'} value={scope} onChange={event => setScope(event.target.value)} className="sm:w-64" />
            </SettingsRow>
          </>}
          {showAuth && (
            <SettingsRow label="Headers" description="One NAME=value per line." htmlFor={id + '-headers'} stacked>
              <Textarea id={id + '-headers'} value={headers} placeholder="Authorization=Bearer …" className="font-mono text-xs"
                onChange={event => setHeaders(event.target.value)} />
            </SettingsRow>
          )}
        </> : <>
          <SettingsRow label="Executable" htmlFor={id + '-command'}>
            <Input id={id + '-command'} required value={command} placeholder="npx" onChange={event => setCommand(event.target.value)} className="font-mono sm:w-64" />
          </SettingsRow>
          <SettingsRow label="Arguments" description="One per line." htmlFor={id + '-args'} stacked>
            <Textarea id={id + '-args'} value={args} placeholder={'-y\npackage-name'} className="font-mono text-xs" onChange={event => setArgs(event.target.value)} />
          </SettingsRow>
          <SettingsRow label="Environment" description="One NAME=value per line." htmlFor={id + '-env'} stacked>
            <Textarea id={id + '-env'} value={env} className="font-mono text-xs" onChange={event => setEnv(event.target.value)} />
          </SettingsRow>
        </>}
      </SettingsGroup>
    </fieldset>
    {error && <ErrorState>{error}</ErrorState>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save server'}</Button>
    </div>
  </form>;
}
