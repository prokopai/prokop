import { useState } from 'react';
import { Folder, Plus, X } from 'lucide-react';
import type { Workspace } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SettingsRow } from '@/components/ui/settings-row';
import { FolderPickerDialog } from '../FolderPickerDialog';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';

interface AdditionalPathsPanelProps {
  workspace: Workspace;
  paths: string[];
  onChange: (paths: string[]) => void;
  sdkClient: import('@prokopai/sdk').ProkopaiClient | null;
}

/** One row per extra directory and an add row, nested under the Additional paths disclosure. */
export function AdditionalPathsPanel({
  paths,
  onChange,
  sdkClient,
}: AdditionalPathsPanelProps) {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const handleRemove = (pathToRemove: string) => {
    onChange(paths.filter(p => p !== pathToRemove));
  };

  const handleAddFolder = (folderPath: string) => {
    if (!paths.includes(folderPath)) {
      onChange([...paths, folderPath]);
    }
  };

  return (
    <>
      {paths.length === 0 ? (
        <SettingsRow className="pl-6" label={<span className="text-xs text-muted-foreground">No additional paths yet.</span>} />
      ) : paths.map((path) => (
        <SettingsRow
          key={path}
          className="pl-6"
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
      <SettingsRow className="pl-6" label={<span className="text-xs text-muted-foreground">Saved with the workspace when you save changes.</span>}>
        <Button variant="outline" size="xs" onClick={() => setFolderPickerOpen(true)}>
          <Plus data-icon="inline-start" />
          Add Path
        </Button>
      </SettingsRow>

      {folderPickerOpen && <FolderPickerDialog
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleAddFolder}
        title="Select Additional Path"
        sdkClient={sdkClient}
      />}
    </>
  );
}
