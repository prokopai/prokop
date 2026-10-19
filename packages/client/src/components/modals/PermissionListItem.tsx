import { Trash2, Shield, Eye, Pencil, Trash, Globe, Terminal } from 'lucide-react';
import type { PermissionGrant } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SettingsRow } from '@/components/ui/settings-row';

// Static component to satisfy react-hooks/static-components rule
function ActionIconDisplay({ action }: { action?: string }) {
  switch (action) {
    case 'read': return <Eye className="size-3" data-icon="inline-start" />;
    case 'write': return <Pencil className="size-3" data-icon="inline-start" />;
    case 'delete': return <Trash className="size-3" data-icon="inline-start" />;
    case 'request': return <Globe className="size-3" data-icon="inline-start" />;
    case 'execute': return <Terminal className="size-3" data-icon="inline-start" />;
    default: return <Shield className="size-3" data-icon="inline-start" />;
  }
}

interface PermissionListItemProps {
  permission: PermissionGrant;
  onRevoke: (permissionId: string) => void;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatScope(scope: string): string {
  switch (scope) {
    case 'once': return 'Once';
    case 'session': return 'Session';
    case 'workspace': return 'Workspace';
    case 'always': return 'Workspace';
    default: return scope;
  }
}

function getActionLabel(action?: string): string | null {
  switch (action) {
    case 'read': return 'Read';
    case 'write': return 'Write';
    case 'delete': return 'Delete';
    case 'request': return 'Network';
    case 'execute': return 'Execute';
    default: return null;
  }
}

function getResourceLabel(resource: string): string {
  switch (resource) {
    case 'file': return 'File';
    case 'path': return 'Path';
    case 'directory': return 'Directory';
    case 'shell-command': return 'Shell';
    case 'network': return 'Network';
    default: return resource;
  }
}

function formatPatternDisplay(patterns: string[]): string {
  if (patterns.length === 0) return 'All';
  return patterns.map(p => {
    if (p.startsWith('file:')) return p.slice(5);
    if (p.startsWith('shell-command:')) return p.slice(15);
    return p;
  }).join(', ');
}

/** One saved permission as a settings row: what it allows on the left, revoke on the right. */
export function PermissionListItem({
  permission,
  onRevoke,
}: PermissionListItemProps) {
  const isRevoked = !!permission.revokedAt;
  const actionLabel = getActionLabel(permission.action);
  const resourceLabel = getResourceLabel(permission.resource);
  const patternDisplay = formatPatternDisplay(permission.patterns);

  return (
    <SettingsRow
      label={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={isRevoked ? 'outline' : 'secondary'}>
            <ActionIconDisplay action={permission.action} />
            {actionLabel ? `${resourceLabel} ${actionLabel}` : resourceLabel}
          </Badge>
          <Badge variant="outline">{permission.toolName}</Badge>
          <Badge variant="outline">{formatScope(permission.scope)}</Badge>
          {permission.matcher !== 'exact' && (
            <Badge variant="outline" className="text-muted-foreground">{permission.matcher}</Badge>
          )}
          {isRevoked && <Badge variant="outline" className="text-muted-foreground">Revoked</Badge>}
        </span>
      }
      description={
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="break-all font-mono">{patternDisplay}</span>
          <span>Saved {formatDate(permission.grantedAt)}{permission.revokedAt && ` · Revoked ${formatDate(permission.revokedAt)}`}</span>
        </span>
      }
    >
      {!isRevoked && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Revoke permission"
          title="Revoke"
          onClick={() => onRevoke(permission.id)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
        </Button>
      )}
    </SettingsRow>
  );
}
