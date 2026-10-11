import { useCallback } from 'react';
import type { FileContextReference, Session } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';

/** The checkout a session's references are relative to; undefined means the workspace root. */
export function sessionReferenceRoot(session: Pick<Session, 'workspaceRootId' | 'worktree'> | null | undefined): string | undefined {
  return session?.workspaceRootId ? session.worktree?.path : undefined;
}

/** Opens a file reference in the file preview, resolved against the session's checkout. */
export function useContextFileOpener(sessionId: string | undefined): ((reference: FileContextReference) => void) | undefined {
  const session = useSessionStore((state) => state.sessions.find((candidate) => candidate.id === sessionId) ?? null);
  const openFilePreview = useUIStore((state) => state.openFilePreview);
  const workspaceId = session?.workspaceId;
  const root = sessionReferenceRoot(session);
  const open = useCallback((reference: FileContextReference) => {
    if (!workspaceId) return;
    openFilePreview({
      workspaceId,
      path: reference.path,
      name: reference.path.slice(reference.path.lastIndexOf('/') + 1),
      ...(root ? { root } : {}),
    });
  }, [workspaceId, root, openFilePreview]);
  return workspaceId ? open : undefined;
}
