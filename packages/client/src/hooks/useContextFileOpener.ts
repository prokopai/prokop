import { useCallback, useMemo } from 'react';
import type { FileContextReference, Session } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';

/** The checkout a session's references are relative to; undefined means the workspace root. */
export function sessionReferenceRoot(session: Pick<Session, 'workspaceRootId' | 'worktree'> | null | undefined): string | undefined {
  return session?.workspaceRootId ? session.worktree?.path : undefined;
}

/** Opens a file reference in the file preview, resolved against the session's checkout. */
export function useContextFileOpener(sessionId: string | undefined, options?: { anywhere?: boolean }): ((reference: FileContextReference) => void) | undefined {
  const session = useSessionStore((state) => state.sessions.find((candidate) => candidate.id === sessionId) ?? null);
  const openFilePreview = useUIStore((state) => state.openFilePreview);
  const workspaceId = session?.workspaceId;
  const root = sessionReferenceRoot(session);
  const anywhere = options?.anywhere ?? false;
  const open = useCallback((reference: FileContextReference) => {
    if (!workspaceId) return;
    openFilePreview({
      workspaceId,
      path: reference.path,
      name: reference.path.slice(reference.path.lastIndexOf('/') + 1),
      ...(root ? { root } : {}),
      ...(anywhere ? { anywhere } : {}),
    });
  }, [workspaceId, root, anywhere, openFilePreview]);
  return workspaceId ? open : undefined;
}

/**
 * Opens a file an agent linked in chat. Relative paths resolve against the
 * session's checkout; absolute paths open anywhere on disk.
 */
export function useFileLinkOpener(sessionId: string | undefined): ((path: string) => void) | undefined {
  const openReference = useContextFileOpener(sessionId, { anywhere: true });
  return useMemo(() => openReference && ((path: string) => openReference({ kind: 'file', path })), [openReference]);
}
