import { Trash2, Shield, Eye, Pencil, Trash, Globe, Terminal } from 'lucide-react';
import type { PermissionGrant } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { CollectionRow, RowTile } from '@/components/ui/collection-row';
import { cn } from '@/lib/utils';

// Static component to satisfy react-hooks/static-components rule
function ActionIconDisplay({ action }: { action?: string }) {
  switch (action) {
    case 'read': return <Eye />;
    case 'write': return <Pencil />;
    case 'delete': return <Trash />;
    case 'request': return <Globe />;
    case 'execute': return <Terminal />;
    default: return <Shield />;
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

/** One saved permission as a collection row: what it allows, then tool, scope and pattern; revoke on the right. */
export function PermissionListItem({
  permission,
  onRevoke,
}: PermissionListItemProps) {
  const isRevoked = !!permission.revokedAt;
  const actionLabel = getActionLabel(permission.action);
  const resourceLabel = getResourceLabel(permission.resource);
  const patternDisplay = formatPatternDisplay(permission.patterns);

  return (
    <CollectionRow
      className={cn(isRevoked && 'text-muted-foreground')}
      icon={<RowTile className={cn(isRevoked && 'opacity-50')}><ActionIconDisplay action={permission.action} /></RowTile>}
      title={<span className="flex min-w-0 items-center gap-2"><span>{actionLabel ? `${resourceLabel} ${actionLabel}` : resourceLabel}</span><span className="truncate font-mono text-xs text-muted-foreground">{patternDisplay}</span></span>}
      status={[
        isRevoked ? 'Revoked' : null,
        permission.toolName,
        formatScope(permission.scope),
        permission.matcher !== 'exact' ? permission.matcher : null,
        `Saved ${formatDate(permission.grantedAt)}${permission.revokedAt ? ` · Revoked ${formatDate(permission.revokedAt)}` : ''}`,
      ].filter(Boolean).join(' · ')}
      actions={!isRevoked && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Revoke permission"
          title="Revoke"
          onClick={() => onRevoke(permission.id)}
          className="text-destructive opacity-0 transition-opacity group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100 hover:text-destructive pointer-coarse:opacity-100"
        >
          <Trash2 />
        </Button>
      )}
    />
  );
}
