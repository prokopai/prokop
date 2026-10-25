import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { FileEntry, ProkopaiClient } from '@prokopai/sdk';
import type { FileActionDialog } from './useFileActions';
import { FileAutocomplete } from './FileAutocomplete';
import { parentDirectory } from './fileActionsCore';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { FormGrid, SettingsRow } from '@/components/ui/settings-row';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface FileActionsDialogsProps {
  dialog: FileActionDialog;
  mutating: boolean;
  error: string | null;
  overwrite: boolean;
  renameConflict: boolean;
  onClose: () => void;
  submitCreate: (name: string) => void;
  submitRename: (to: string) => void;
  submitDelete: () => void;
  setOverwrite: (checked: boolean) => void;
  /** The move dialog's submit and the folder search it offers; only the tree opens that dialog. */
  submitMove?: (directory: string) => void;
  sdkClient?: ProkopaiClient | null;
  workspaceId?: string;
  root?: string;
}

/** Focus the input and select everything after the last '/'. */
function useSelectBasenameOnOpen(open: boolean, inputRef: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    if (!open) return;
    // Double rAF: wait for Radix mount + focus trap before selecting.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const lastSlash = el.value.lastIndexOf('/');
        el.setSelectionRange(lastSlash + 1, el.value.length);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, inputRef]);
}

interface NameEntryFormProps {
  open: boolean;
  initialValue: string;
  label: string;
  helper: string;
  placeholder: string;
  submitLabel: string;
  mutating: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  footerExtra?: React.ReactNode;
}

function NameEntryForm({
  open,
  initialValue,
  label,
  helper,
  placeholder,
  submitLabel,
  mutating,
  error,
  onCancel,
  onSubmit,
  footerExtra,
}: NameEntryFormProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useSelectBasenameOnOpen(open, inputRef);
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <FormGrid>
        <SettingsRow label={label} htmlFor="file-action-name" description={error ? <span className="text-error">{error}</span> : helper || undefined} stacked>
          <Input
            id="file-action-name"
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </SettingsRow>
        {footerExtra}
      </FormGrid>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={mutating}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutating}>
          {mutating && <Loader2 data-icon="inline-start" className="animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CreateFileDialog({
  dialog,
  mutating,
  error,
  onClose,
  submitCreate,
}: FileActionsDialogsProps) {
  const open = dialog?.type === 'create';
  const kind = dialog?.type === 'create' ? dialog.kind : 'file';
  const parentDirPath = dialog?.type === 'create' ? dialog.parentDirPath : '';
  const title = kind === 'directory' ? 'New Folder' : 'New File';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Created in {parentDirPath || 'the workspace root'} (missing parents are created automatically)
          </DialogDescription>
        </DialogHeader>
        <NameEntryForm
          open={open}
          initialValue=""
          label={kind === 'directory' ? 'Folder name' : 'File name'}
          helper=""
          placeholder={kind === 'directory' ? 'Folder name' : 'File name'}
          submitLabel={kind === 'directory' ? 'Create Folder' : 'Create File'}
          mutating={mutating}
          error={error}
          onCancel={onClose}
          onSubmit={submitCreate}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  dialog,
  mutating,
  error,
  overwrite,
  renameConflict,
  onClose,
  submitRename,
  setOverwrite,
}: FileActionsDialogsProps) {
  const open = dialog?.type === 'rename';
  const target = dialog?.type === 'rename' ? dialog.target : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.isDirectory ? 'Rename Folder' : 'Rename File'}</DialogTitle>
          <DialogDescription>
            Rename or move {target?.isDirectory ? 'folder' : 'file'} {target?.name ?? ''}. Paths are relative to the workspace root.
          </DialogDescription>
        </DialogHeader>
        <NameEntryForm
          open={open}
          initialValue={target?.path ?? ''}
          label="New path"
          helper=""
          placeholder="Relative path"
          submitLabel="Rename"
          mutating={mutating}
          error={error}
          onCancel={onClose}
          onSubmit={submitRename}
          footerExtra={
            renameConflict && target && !target.isDirectory ? (
              <SettingsRow label="Replace the existing destination file" htmlFor="file-action-overwrite">
                <Switch
                  id="file-action-overwrite"
                  checked={overwrite}
                  onCheckedChange={(checked) => setOverwrite(checked === true)}
                />
              </SettingsRow>
            ) : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  dialog,
  mutating,
  error,
  onClose,
  submitDelete,
}: FileActionsDialogsProps) {
  const open = dialog?.type === 'delete';
  const target = dialog?.type === 'delete' ? dialog.target : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.isDirectory ? 'Delete Folder' : 'Delete File'}</DialogTitle>
          <DialogDescription>
            {target?.isDirectory
              ? `Delete folder ${target.name} and all of its contents? This cannot be undone.`
              : `Delete file ${target?.name ?? ''}? This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-error">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutating}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submitDelete} disabled={mutating}>
            {mutating && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Move a file or folder into another folder: type the destination, or pick
 * it from the folders matching what was typed. Empty means the workspace
 * root. Arrows walk the matches and Enter takes the walked-to one; Enter
 * with nothing walked to moves to what is typed.
 */
function MoveDialog({ dialog, mutating, error, onClose, submitMove, sdkClient, workspaceId, root }: FileActionsDialogsProps) {
  const open = dialog?.type === 'move';
  const target = dialog?.type === 'move' ? dialog.target : null;
  const [directory, setDirectory] = useState('');
  const [matches, setMatches] = useState<FileEntry[]>([]);
  const [walked, setWalked] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setDirectory(target ? parentDirectory(target.path) : '');
    setMatches([]);
    setWalked(null);
    const raf = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(raf);
  }, [open, target]);

  const pick = (entry: FileEntry) => {
    setDirectory(entry.path);
    setWalked(null);
    inputRef.current?.focus();
  };
  // Stable for the list: a fresh callback each render would make it search again
  // and lose the walked row. The walk resets only when the folders really change.
  const handleMatches = useCallback((files: FileEntry[]) => {
    setMatches((current) => {
      const same = current.length === files.length && current.every((entry, index) => entry.path === files[index]!.path);
      if (same) return current;
      setWalked(null);
      return files;
    });
  }, []);
  const submit = () => submitMove?.(directory.trim());
  const from = target ? parentDirectory(target.path) : '';
  const searching = directory.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.isDirectory ? 'Move Folder' : 'Move File'}</DialogTitle>
          <DialogDescription>
            Move {target?.name ?? ''} from {from || 'the workspace root'} to another folder. Leave empty for the workspace root.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormGrid>
            <SettingsRow label="Destination folder" htmlFor="file-action-move-to" description={error ? <span className="text-error">{error}</span> : undefined} stacked>
              <Input
                id="file-action-move-to"
                ref={inputRef}
                value={directory}
                onChange={(event) => { setDirectory(event.target.value); setWalked(null); }}
                onKeyDown={(event) => {
                  if (matches.length === 0) return;
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setWalked((index) => (index === null ? 0 : (index + 1) % matches.length));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setWalked((index) => (index === null ? matches.length - 1 : (index - 1 + matches.length) % matches.length));
                  } else if ((event.key === 'Enter' || event.key === 'Tab') && walked !== null && matches[walked]) {
                    event.preventDefault();
                    pick(matches[walked]);
                  }
                }}
                placeholder="Folder path, or empty for the root"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                aria-autocomplete="list"
              />
            </SettingsRow>
            {open && sdkClient && workspaceId && searching && (
              <div className="-mt-2 rounded-md border">
                <FileAutocomplete
                  workspaceId={workspaceId}
                  sdkClient={sdkClient}
                  root={root}
                  searchQuery={directory.trim()}
                  selectedIndex={walked ?? -1}
                  onSelectedIndexChange={setWalked}
                  onSelect={pick}
                  onFilesChange={handleMatches}
                  directoriesOnly
                />
              </div>
            )}
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutating}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutating}>
              {mutating && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FileActionsDialogs(props: FileActionsDialogsProps) {
  return (
    <>
      <CreateFileDialog {...props} />
      <RenameDialog {...props} />
      <MoveDialog {...props} />
      <DeleteDialog {...props} />
    </>
  );
}
