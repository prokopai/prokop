import { useState } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { usePromptsQuery, useCreatePrompt, useUpdatePrompt, useDeletePrompt } from '@/hooks/queries';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { SettingsEditorHeader, SettingsEmpty, SettingsError, SettingsListRow, SettingsLoading } from './SettingsPrimitives';
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
      <div className="p-3 sm:p-4 space-y-4">
        <SettingsEditorHeader title={isCreating ? 'New prompt' : 'Edit prompt'} onBack={editor.cancel}
          backLabel="Back to prompts" onSave={editor.save} saving={editor.saving} canSave={!!editName.trim()} />

        {error && <SettingsError>{error}</SettingsError>}

        <div>
          <label className="text-sm font-medium mb-1 block">Name</label>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            disabled={!isCreating}
            placeholder="prompt-name"
            className="font-mono"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Content (Markdown)</label>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-48 sm:h-64 p-3 rounded-lg border bg-background font-mono text-sm resize-y"
            placeholder="# Prompt Title\n\nPrompt content here..."
          />
        </div>
      </div>
    );
  }

  if (loading) return <SettingsLoading />;

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {prompts.length} prompt{prompts.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={editor.startCreate}>
          <Plus className="size-3" data-icon="inline-start" />
          New Prompt
        </Button>
      </div>

      {error && <SettingsError>{error}</SettingsError>}

      {prompts.length === 0 ? (
        <SettingsEmpty>No prompts yet. Create one to get started.</SettingsEmpty>
      ) : (
        <div className="space-y-1.5">
          {prompts.map((prompt) => (
            <SettingsListRow
              key={prompt.name}
              title={prompt.name}
              description={prompt.description}
              onOpen={() => editor.startEdit(prompt)}
              actions={(
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setDeleteTarget(prompt.name)}
                  aria-label={`Delete prompt ${prompt.name}`}
                  title="Delete prompt"
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            />
          ))}
        </div>
      )}

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
