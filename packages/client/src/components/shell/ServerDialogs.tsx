import { Suspense, lazy } from 'react';
import { useParams } from '@tanstack/react-router';
import { useShallow } from 'zustand/react/shallow';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore, selectActiveWorkspace } from '@/stores/serverDataStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { groupViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';

const SchedulerJobModal = lazy(() =>
  import('@/components/modals/SchedulerJobModal').then((m) => ({ default: m.SchedulerJobModal })),
);
const FilePreviewOverlay = lazy(() =>
  import('@/components/files/FilePreviewOverlay'),
);
const GroupDialog = lazy(() =>
  import('@/components/groups/GroupDialog').then((m) => ({ default: m.GroupDialog })),
);

interface ServerDialogsProps {
  sdkClient: ProkopaiClient | null;
}

function DialogLoadingFallback() {
  return null;
}

export function ServerDialogs({
  sdkClient,
}: ServerDialogsProps) {
  const params = useParams({
    from: '/server/$serverId',
    strict: false,
  } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const activeWorkspace = useServerDataStore(selectActiveWorkspace);

  const {
    showSchedulerJob,
    editingSchedulerJob,
    setShowSchedulerJob,
  } = useUIStore(
    useShallow((s) => ({
      showSchedulerJob: s.showSchedulerJob,
      editingSchedulerJob: s.editingSchedulerJob,
      setShowSchedulerJob: s.setShowSchedulerJob,
    })),
  );

  const { filePreviewTarget, closeFilePreview } = useUIStore(
    useShallow((s) => ({
      filePreviewTarget: s.filePreviewTarget,
      closeFilePreview: s.closeFilePreview,
    })),
  );
  const { showGroupDialog, editingGroup, setShowGroupDialog } = useUIStore(
    useShallow((s) => ({
      showGroupDialog: s.showGroupDialog,
      editingGroup: s.editingGroup,
      setShowGroupDialog: s.setShowGroupDialog,
    })),
  );

  return (
    <>
      {(showSchedulerJob || filePreviewTarget !== null || showGroupDialog) && (
        <Suspense fallback={<DialogLoadingFallback />}>
          {showGroupDialog && (
            <GroupDialog
              open={showGroupDialog}
              onOpenChange={(open) => setShowGroupDialog(open)}
              sdkClient={sdkClient}
              workspaceId={activeWorkspace?.id ?? null}
              editingGroup={editingGroup}
              onCreated={(group) => {
                // A new group opens at once, like a new session.
                if (serverId) useWorkspaceViewStore.getState().openInCenter(groupViewId(serverId, group.id));
              }}
            />
          )}
          {showSchedulerJob && (
            <SchedulerJobModal
              open={showSchedulerJob}
              onOpenChange={(open) => setShowSchedulerJob(open)}
              sdkClient={sdkClient}
              workspaceId={activeWorkspace?.id ?? null}
              editingJob={editingSchedulerJob}
            />
          )}

          {filePreviewTarget !== null && (
            <FilePreviewOverlay
              workspaceId={filePreviewTarget.workspaceId}
              target={filePreviewTarget}
              sdkClient={sdkClient}
              open={filePreviewTarget !== null}
              onOpenChange={(open) => {
                if (!open) closeFilePreview();
              }}
              onOpenEdit={serverId ? () => {
                useFileEditorStore.getState().openDoc(
                  {
                    serverId,
                    workspaceId: filePreviewTarget.workspaceId,
                    root: filePreviewTarget.root ?? '',
                    path: filePreviewTarget.path,
                  },
                  filePreviewTarget.name,
                );
                // The phone shows the editor surface; on desktop the editor tab is already in place.
                useWorkspaceViewStore.getState().setMobileSurface('editor');
                closeFilePreview();
              } : undefined}
            />
          )}
        </Suspense>
      )}
    </>
  );
}
