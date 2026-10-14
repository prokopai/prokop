import { getSession } from '@/infrastructure/storage/runtime';
import { notifyWorkspaceFilesChanged } from '@/application/workspaces/files-changed';

/**
 * Rollback dispatch: the CLI restores files as part of the rollback turn and
 * may run no tools afterwards, so the revert site notifies on its own.
 */
export async function notifySessionFilesChanged(sessionId: string): Promise<void> {
  const workspaceId = (await getSession(sessionId))?.workspaceId;
  if (workspaceId) notifyWorkspaceFilesChanged(workspaceId);
}
