import { useState } from 'react';
import { toast } from 'sonner';
import type {
  ProkopaiClient,
  ModelRuntimeStatus,
  ModelWithStatus,
  ProviderAccountStatus,
  ProviderCredentialStatus,
} from '@prokopai/sdk';
import { useDeleteModel } from '@/hooks/queries';
import { Plus, Pencil, Trash2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SettingsRow } from '@/components/ui/settings-row';
import { ProviderTile } from '@/components/branding/ProviderTile';
import { cn } from '@/lib/utils';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProviderCredentialsPanel } from '../ProviderCredentialsPanel';
import { OAuthProvidersPanel } from '../OAuthProvidersPanel';
import { ModelEditorForm } from './ModelEditorForm';

function ModelStatusDot({ status }: { status: ModelRuntimeStatus }) {
  if (status.usable) {
    return <span className="size-1.5 shrink-0 rounded-full bg-success" title="Usable" />;
  }
  if (status.providerSupported && !status.providerConfigured) {
    return <span className="size-1.5 shrink-0 rounded-full bg-warning" title="Needs configuration" />;
  }
  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" title="Unsupported" />;
}

interface ProviderCardProps {
  sdkClient: ProkopaiClient | null;
  provider: { id: string; name: string; models: ModelWithStatus[] };
  defaultProvider: string;
  defaultModel: string;
  credential?: ProviderCredentialStatus;
  oauth?: ProviderAccountStatus;
}

/**
 * One provider = one header row plus, when expanded, its connection row, a
 * row per model and the add model row. Lives inside the Providers group.
 * Providers themselves are read-only catalog entries (models.json or
 * registry sync owns them).
 */
export function ProviderCard({
  sdkClient,
  provider,
  defaultProvider,
  defaultModel,
  credential,
  oauth,
}: ProviderCardProps) {
  const deleteModelMut = useDeleteModel(sdkClient);
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState<
    null | { kind: 'new-model' } | { kind: 'model'; model: ModelWithStatus }
  >(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<ModelWithStatus | null>(null);
  const [deletingModel, setDeletingModel] = useState(false);

  const status = oauth
    ? oauth.reauthRequired
      ? { tone: 'amber' as const, label: 'Reconnect' }
      : oauth.connected
        ? { tone: 'green' as const, label: 'Connected' }
        : { tone: 'muted' as const, label: 'Not connected' }
    : credential
      ? credential.configured
        ? { tone: 'green' as const, label: 'Connected' }
        : { tone: 'amber' as const, label: 'Needs key' }
      : { tone: 'muted' as const, label: 'Custom' };
  const dotClass = status.tone === 'green'
    ? 'bg-success'
    : status.tone === 'amber' ? 'bg-warning' : 'bg-muted-foreground/40';
  const isDefaultProvider = provider.id === defaultProvider;
  const open = expanded || editor !== null;
  const count = provider.models.length > 0
    ? `${provider.models.length} model${provider.models.length !== 1 ? 's' : ''}`
    : 'no models';

  const handleDeleteModel = async () => {
    if (!deleteModelTarget) return;
    setDeletingModel(true);
    try {
      await deleteModelMut.mutateAsync({ providerId: provider.id, modelId: deleteModelTarget.id });
      setDeleteModelTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete model';
      toast.error('Failed to delete model', { description: message });
    } finally {
      setDeletingModel(false);
    }
  };

  return (
    <>
      <SettingsRow
        onClick={() => setExpanded(!expanded)}
        expanded={open}
        className={cn(status.tone !== 'green' && 'text-muted-foreground')}
        label={
          <span className="flex items-center gap-2">
            <ProviderTile provider={provider.id} name={provider.name} size="sm" />
            <span className={cn('size-2 shrink-0 rounded-full', dotClass)} />
            <span className={cn('truncate', status.tone === 'green' && 'text-foreground')}>{provider.name}</span>
            {isDefaultProvider && (
              <Badge variant="outline" className="gap-0.5"><Star className="size-2.5" />Default</Badge>
            )}
          </span>
        }
        description={`${count} · ${status.label}`}
      />

      {open && (editor ? (
        <ModelEditorForm
          sdkClient={sdkClient}
          providerId={provider.id}
          providerName={provider.name}
          model={editor.kind === 'model' ? editor.model : null}
          onDone={() => setEditor(null)}
        />
      ) : (
        <>
          {oauth && <OAuthProvidersPanel sdkClient={sdkClient} provider={provider.id} embedded />}
          {!oauth && credential && <ProviderCredentialsPanel sdkClient={sdkClient} provider={provider.id} embedded />}
          {!oauth && !credential && (
            <SettingsRow label="API key" description="Custom provider. Set its key in ~/.prokopai/.env to use its models." />
          )}

          {provider.models.length === 0 ? (
            <SettingsRow label={<span className="text-xs text-muted-foreground">No models in the catalog. Add one or sync from the registry.</span>} />
          ) : (
            provider.models.map((model) => {
              const isDefault = model.id === defaultModel && provider.id === defaultProvider;
              return (
                <SettingsRow
                  key={model.id}
                  className="pl-6"
                  label={
                    <span className="flex items-center gap-2" title={model.id}>
                      <ModelStatusDot status={model.runtimeStatus} />
                      <span className="truncate">{model.name}</span>
                      {isDefault && (
                        <Badge variant="outline" className="gap-0.5"><Star className="size-2.5" />Default</Badge>
                      )}
                    </span>
                  }
                >
                  <span className="flex items-center gap-0.5">
                    <Button size="icon-xs" variant="ghost" onClick={() => setEditor({ kind: 'model', model })} title="Edit model" aria-label={`Edit ${model.name}`}>
                      <Pencil />
                    </Button>
                    <Button size="icon-xs" variant="ghost" onClick={() => setDeleteModelTarget(model)} title="Delete model" aria-label={`Delete ${model.name}`}>
                      <Trash2 />
                    </Button>
                  </span>
                </SettingsRow>
              );
            })
          )}

          <SettingsRow className="pl-6" label={<span className="text-xs text-muted-foreground">Models are catalog entries for this provider.</span>}>
            <Button variant="outline" size="xs" onClick={() => setEditor({ kind: 'new-model' })}>
              <Plus data-icon="inline-start" />
              Add model
            </Button>
          </SettingsRow>
        </>
      ))}

      <ConfirmationDialog
        open={deleteModelTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteModelTarget(null); }}
        title="Delete Model"
        description={`Are you sure you want to delete "${deleteModelTarget?.name}"?${deleteModelTarget?.id === defaultModel && provider.id === defaultProvider ? ' Warning: This is the current default model.' : ''}`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteModel}
        loading={deletingModel}
        closeOnConfirm={false}
      />
    </>
  );
}
