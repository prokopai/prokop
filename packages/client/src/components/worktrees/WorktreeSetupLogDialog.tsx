import type { ManagedWorktree, ProkopaiClient } from '@prokopai/sdk';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWorktreeSetupLogQuery } from '@/hooks/queries';

interface WorktreeSetupLogDialogProps {
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
  /** The worktree whose log to show; null keeps the dialog closed. */
  worktree: ManagedWorktree | null;
  onClose: () => void;
}

/**
 * The output of a worktree's setup and teardown commands. Loads when opened
 * and again when the worktree's setup state or step changes, so a running
 * setup reveals each finished step without polling.
 */
export function WorktreeSetupLogDialog({ sdkClient, workspaceId, worktree, onClose }: WorktreeSetupLogDialogProps) {
  const log = useWorktreeSetupLogQuery(sdkClient, workspaceId, worktree);
  const text = log.data ?? '';
  return (
    <Dialog open={worktree !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Setup log</DialogTitle>
          <DialogDescription>
            {worktree?.name}
            {worktree?.setup.step ? ` · ${worktree.setup.step}` : ''}
          </DialogDescription>
        </DialogHeader>
        <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {log.isLoading ? 'Loading…' : text || 'No output yet.'}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
