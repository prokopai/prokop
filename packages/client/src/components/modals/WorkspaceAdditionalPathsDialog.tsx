import { useState, useEffect } from 'react';
import { Folder, Plus, X } from 'lucide-react';
import type { Workspace } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormGrid, SettingsRow } from '@/components/ui/settings-row';
import { FolderPickerDialog } from './FolderPickerDialog';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';

interface WorkspaceAdditionalPathsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  onSave: (workspaceId: string, additionalPaths: string[]) => void;
  isSaving?: boolean;
  sdkClient: import('@prokopai/sdk').ProkopaiClient | null;
}

export function WorkspaceAdditionalPathsDialog({
  open,
  onOpenChange,
  workspace,
  onSave,
  isSaving = false,
  sdkClient,
}: WorkspaceAdditionalPathsDialogProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setPaths(workspace.additionalPaths ?? []);
    }
  }, [open, workspace.additionalPaths]);

  const handleRemove = (pathToRemove: string) => {
    setPaths(prev => prev.filter(p => p !== pathToRemove));
  };

  const handleAddFolder = (folderPath: string) => {
    if (!paths.includes(folderPath)) {
      setPaths(prev => [...prev, folderPath]);
    }
  };

  const handleSave = () => {
    onSave(workspace.id, paths);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Additional paths</DialogTitle>
          </DialogHeader>

          <FormGrid className="dialog-scrollbar max-h-80 overflow-y-auto">
            {paths.length === 0 ? (
              <SettingsRow label={<span className="text-xs text-muted-foreground">No additional paths yet.</span>} />
            ) : paths.map((path) => (
              <SettingsRow
                key={path}
                label={
                  <span className="flex min-w-0 items-center gap-2" title={path}>
                    <Folder className={cn('size-3.5 shrink-0', FOLDER_ICON_COLOR)} />
                    <span className="truncate font-mono text-xs">{path}</span>
                  </span>
                }
              >
                <Button variant="ghost" size="icon-xs" aria-label={`Remove ${path}`} onClick={() => handleRemove(path)}>
                  <X />
                </Button>
              </SettingsRow>
            ))}
            <SettingsRow label="Add a directory" description={`Used by the agent alongside ${workspace.name}, by absolute path.`}>
              <Button variant="outline" size="xs" onClick={() => setFolderPickerOpen(true)}>
                <Plus data-icon="inline-start" />
                Add Path
              </Button>
            </SettingsRow>
          </FormGrid>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FolderPickerDialog
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleAddFolder}
        title="Select Additional Path"
        sdkClient={sdkClient}
      />
    </>
  );
}
