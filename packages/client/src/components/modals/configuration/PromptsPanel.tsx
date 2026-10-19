import { useState } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { usePromptsQuery, useCreatePrompt, useUpdatePrompt, useDeletePrompt } from '@/hooks/queries';
import { FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { CollectionRow, RowTile } from '@/components/ui/collection-row';
import { PageActions } from '@/components/views/settingsPageActions';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/States';
import { useSettingsEditor } from './useSettingsEditor';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
}

interface PromptInfo {
  name: string;
  description: string;
  content: string;
}

export function PromptsPanel({ sdkClient }: PanelProps) {
  const { data: promptsData, isLoading: loading } = usePromptsQuery(sdkClient);
  const createPromptMut = useCreatePrompt(sdkClient);
  const updatePromptMut = useUpdatePrompt(sdkClient);
  const deletePromptMut = useDeletePrompt(sdkClient);
  const prompts: PromptInfo[] = promptsData?.prompts ?? [];
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');

  const editor = useSettingsEditor<PromptInfo, string>({
    load: (prompt) => {
      setEditName(prompt?.name ?? '');
      setEditContent(prompt?.content ?? '# New Prompt\n\n');
    },
    save: async (prompt) => {
      if (!editName.trim()) return false;
      if (prompt) await updatePromptMut.mutateAsync({ name: prompt.name, body: { content: editContent } });
      else await createPromptMut.mutateAsync({ name: editName.trim(), content: editContent });
    },
    remove: (name) => deletePromptMut.mutateAsync(name),
    saveError: 'Failed to save prompt',
    deleteError: 'Failed to delete prompt',
  });
  const { isCreating, error, deleteTarget, setDeleteTarget } = editor;

  if (editor.isOpen) {
    return (
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        <SettingsGroup label={isCreating ? 'New prompt' : 'Edit prompt'}>
          <SettingsRow label="Name" htmlFor="prompt-name" description={isCreating ? 'Typed after a slash in the composer.' : undefined}>
            <Input
              id="prompt-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={!isCreating}
              placeholder="prompt-name"
              className="font-mono sm:w-64"
            />
          </SettingsRow>
          <SettingsRow label="Content" description="Markdown." htmlFor="prompt-content" stacked>
            <Textarea
              id="prompt-content"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-48 font-mono text-xs sm:min-h-64"
              placeholder="# Prompt Title\n\nPrompt content here..."
            />
          </SettingsRow>
        </SettingsGroup>
        {error && <ErrorState>{error}</ErrorState>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={editor.cancel} aria-label="Back to prompts">Cancel</Button>
          <Button onClick={editor.save} disabled={editor.saving || !editName.trim()}>
            {editor.saving ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <PageActions>
        <Button onClick={editor.startCreate}>
          <Plus data-icon="inline-start" />
          New prompt
        </Button>
      </PageActions>
      {prompts.length > 0 && (
        <SettingsGroup description="Reusable text, typed after a slash in the composer.">
          {prompts.map((prompt) => (
            <CollectionRow
              key={prompt.name}
              icon={<RowTile><FileText /></RowTile>}
              title={<span className="font-mono text-xs">{prompt.name}</span>}
              status={prompt.description || undefined}
              onOpen={() => editor.startEdit(prompt)}
              actions={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="opacity-0 transition-opacity group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100 pointer-coarse:opacity-100"
                  onClick={() => setDeleteTarget(prompt.name)}
                  aria-label={`Delete prompt ${prompt.name}`}
                  title="Delete prompt"
                >
                  <Trash2 />
                </Button>
              }
            />
          ))}
        </SettingsGroup>
      )}

      {error && <ErrorState>{error}</ErrorState>}
      {prompts.length === 0 && <EmptyState variant="plain">No prompts yet. Add one to reuse text in the composer.</EmptyState>}

      <ConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Prompt"
        description={`Are you sure you want to delete the prompt "${deleteTarget}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={editor.confirmDelete}
        loading={deletePromptMut.isPending}
        closeOnConfirm={false}
      />
    </div>
  );
}
