import { useEffect, useState } from 'react';
import type { SavedServer } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormGrid, SettingsRow } from '@/components/ui/settings-row';

interface RenameServerDialogProps {
  server: SavedServer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (id: string, name: string) => string | null;
}

export function RenameServerDialog({
  server,
  open,
  onOpenChange,
  onRename,
}: RenameServerDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !server) return;
    setName(server.name);
    setError(null);
  }, [open, server]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!server) return;
    const renameError = onRename(server.id, name);
    if (renameError) {
      setError(renameError);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename server</DialogTitle>
          </DialogHeader>
          <FormGrid>
            <SettingsRow label="Name" htmlFor="server-rename" description={error ? <span className="text-error">{error}</span> : 'Only on this device.'}>
              <Input
                id="server-rename"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                aria-invalid={error !== null}
                autoFocus
                className="sm:w-64"
              />
            </SettingsRow>
          </FormGrid>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit">Rename</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
