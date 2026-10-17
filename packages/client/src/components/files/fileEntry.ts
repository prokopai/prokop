import type { FileEntry } from '@prokopai/sdk';

/** How a file entry opens: the read-only preview overlay or the persistent editor. */
export type FileOpenMode = 'preview' | 'edit';

export interface FileEntryActionTarget {
  entry: FileEntry;
  root?: string;
}

export interface FileEntryActions {
  open: (target: FileEntryActionTarget, mode?: FileOpenMode) => void;
}
