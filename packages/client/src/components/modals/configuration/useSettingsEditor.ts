import { useState } from 'react';
import { toast } from 'sonner';

interface SettingsEditorOptions<Item, DeleteTarget> {
  /** Fill the panel's own draft fields: from `item`, or empty for a new one. */
  load: (item: Item | null) => void;
  /**
   * Create (`item` is null) or update `item`. Throw to show the error in the
   * editor; return false to stay open when the panel shows its own message.
   */
  save: (item: Item | null) => Promise<void | false>;
  remove: (target: DeleteTarget) => Promise<unknown>;
  /** Shown when a save fails without its own message. */
  saveError: string;
  /** Toast title when a delete fails. */
  deleteError: string;
}

/**
 * The list/editor lifecycle shared by settings panels: which item is open,
 * saving, the error shown in the editor, and the delete confirmation.
 */
export function useSettingsEditor<Item, DeleteTarget>({
  load,
  save,
  remove,
  saveError,
  deleteError,
}: SettingsEditorOptions<Item, DeleteTarget>) {
  const [open, setOpen] = useState<{ item: Item | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const start = (item: Item | null) => {
    load(item);
    setError(null);
    setOpen({ item });
  };

  const handleSave = async () => {
    if (!open) return;
    setSaving(true);
    setError(null);
    try {
      if (await save(open.item) !== false) setOpen(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : saveError);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    try {
      await remove(deleteTarget);
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : deleteError;
      setError(message);
      toast.error(deleteError, { description: message });
    }
  };

  return {
    isOpen: open !== null,
    isCreating: open !== null && open.item === null,
    editing: open?.item ?? null,
    startCreate: () => start(null),
    startEdit: (item: Item) => start(item),
    cancel: () => setOpen(null),
    save: handleSave,
    saving,
    error,
    deleteTarget,
    setDeleteTarget,
    confirmDelete,
  };
}
