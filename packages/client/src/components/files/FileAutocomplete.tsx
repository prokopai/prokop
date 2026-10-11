import { useState, useEffect, useRef } from 'react';
import { File, Folder, Loader2 } from 'lucide-react';
import type { FileEntry } from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import { fileIconColor, FOLDER_ICON_COLOR } from './fileIcons';

interface FileAutocompleteProps {
  workspaceId: string;
  searchQuery: string;
  selectedIndex: number;
  /** Hovering a row selects it, so only one row is ever highlighted. */
  onSelectedIndexChange: (index: number) => void;
  onSelect: (file: FileEntry) => void;
  onFilesChange: (files: FileEntry[]) => void;
  showHidden?: boolean;
  sdkClient?: ProkopaiClient | null;
  /** The session's checkout; omitted for the workspace root. */
  root?: string;
}

/** Indexes of the query's characters in a file name: a substring, else an in-order match. */
function matchedIndexes(name: string, query: string): Set<number> {
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase().replace(/^.*\//, '');
  const marked = new Set<number>();
  if (!lowerQuery) return marked;
  const substring = lowerName.indexOf(lowerQuery);
  if (substring !== -1) {
    for (let i = 0; i < lowerQuery.length; i++) marked.add(substring + i);
    return marked;
  }
  let position = 0;
  for (const char of lowerQuery) {
    const index = lowerName.indexOf(char, position);
    // A partial match would highlight letters that did not decide the result.
    if (index === -1) return new Set();
    marked.add(index);
    position = index + 1;
  }
  return marked;
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const marked = matchedIndexes(name, query);
  if (marked.size === 0) return <>{name}</>;
  return (
    <>
      {Array.from(name, (char, index) => (
        marked.has(index) ? <mark key={index} className="bg-transparent font-semibold text-primary">{char}</mark> : char
      ))}
    </>
  );
}

function splitPath(filePath: string): { fileName: string; dirPath: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) {
    return { fileName: filePath, dirPath: '' };
  }
  return {
    fileName: filePath.slice(lastSlash + 1),
    dirPath: filePath.slice(0, lastSlash),
  };
}

/** About eight rows; the rest scroll. */
const LIST_MAX_HEIGHT = 'max-h-[16.5rem]';

export function FileAutocomplete({
  workspaceId,
  searchQuery,
  selectedIndex,
  onSelectedIndexChange,
  onSelect,
  onFilesChange,
  showHidden = true,
  sdkClient,
  root,
}: FileAutocompleteProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const queryIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard selection visible inside the list without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop - 4;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight + 4;
    }
  }, [selectedIndex, files]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 120);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!sdkClient) {
      setFiles([]);
      onFilesChange([]);
      return;
    }

    const queryId = ++queryIdRef.current;
    setLoading(true);
    setError(null);

    const controller = new AbortController();

    sdkClient?.httpClient
      .get<{ files: FileEntry[] }>(`/workspaces/${workspaceId}/files`, {
        // An empty query lists files with Git changes, the likeliest references.
        params: {
          ...(debouncedQuery ? { search: debouncedQuery } : { suggest: 'changed' }),
          showHidden: String(showHidden),
          ...(root ? { root } : {}),
        },
        signal: controller.signal,
      })
      .then(data => {
        if (queryId !== queryIdRef.current) return;
        const newFiles = data.files || [];
        setFiles(newFiles);
        onFilesChange(newFiles);
      })
      .catch(err => {
        if (err instanceof Error && err.name !== 'AbortError') {
          // Transient network failures (e.g. a superseded search aborting a
          // mid-flight glob on the server) must not wedge the popover. Record
          // the error so the next keystroke can recover instead of leaving the
          // component in a loading state with no results and no way forward.
          if (queryId === queryIdRef.current) {
            setError(err.message || 'Search failed');
            setLoading(false);
          }
          console.error('File search failed:', err);
        }
      })
      .finally(() => {
        if (queryId === queryIdRef.current) setLoading(false);
      });

    return () => controller.abort();
  }, [workspaceId, debouncedQuery, onFilesChange, showHidden, sdkClient, root]);

  if (loading && files.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-3.5 animate-spin" />
        Searching…
      </div>
    );
  }

  if (error && files.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">Search failed. Keep typing to retry.</div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {searchQuery ? <>No files match &quot;{searchQuery}&quot;</> : 'No changed files. Type to search.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {!searchQuery && <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">Changed files</div>}
      <div ref={listRef} role="listbox" aria-label="Files" className={cn('relative overflow-y-auto p-1', LIST_MAX_HEIGHT)}>
        {files.map((file, index) => {
          const { fileName, dirPath } = splitPath(file.path);
          const isFolder = file.type === 'directory';
          const Icon = isFolder ? Folder : File;
          return (
            <button
              key={file.path}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              data-index={index}
              title={isFolder ? `${file.path}/` : file.path}
              onClick={() => onSelect(file)}
              onMouseMove={(event) => {
                // Browsers send a motionless mousemove after the list scrolls under a resting
                // pointer; only real movement may take the selection from the arrow keys.
                if ((event.movementX || event.movementY) && index !== selectedIndex) onSelectedIndexChange(index);
              }}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm',
                // bg-accent is nearly the popover color in dark themes; the selection must be unmistakable.
                index === selectedIndex && 'bg-primary/15 text-foreground',
              )}
            >
              <Icon className={cn('size-4 shrink-0', isFolder ? FOLDER_ICON_COLOR : fileIconColor(file.path))} />
              {/* The name keeps its width; the folder gives way first. */}
              <span className="max-w-[75%] shrink-0 truncate">
                <HighlightedName name={fileName} query={searchQuery} />
                {isFolder && '/'}
              </span>
              {dirPath && (
                // rtl moves the ellipsis to the start, keeping the nearest folders visible.
                <span dir="rtl" className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
                  <bdi>{dirPath}</bdi>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span><kbd className="font-sans">↵</kbd> insert</span>
        <span><kbd className="font-sans">⇥</kbd> open folder</span>
        <span><kbd className="font-sans">esc</kbd></span>
      </div>
    </div>
  );
}
